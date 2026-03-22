import { Pool, PoolClient } from 'pg';

export interface Session {
  id: number;
  started_at: string;
  ended_at: string | null;
  working_dir: string;
  shell: string;
}

export interface Command {
  id: number;
  session_id: number;
  input: string;
  working_dir: string;
  timestamp: string;
  exit_code: number | null;
  claude_suggested: boolean;
  output: string;
}

export interface Bookmark {
  id: number;
  command_id: number;
  title: string;
  notes: string | null;
  tags: string | null;
  created_at: string;
  command: Command;
}

export interface Lesson {
  id: number;
  title: string;
  description: string;
  session_id: number;
  created_at: string;
  command_count: number;
}

export interface CLISession {
  id: number;
  session_id: number;
  command_id: number | null;
  program_id: string;
  program_name: string;
  program_color: string;
  started_at: string;
  ended_at: string | null;
  input_count?: number;
}

export interface CLIInput {
  id: number;
  cli_session_id: number;
  input: string;
  output_preview: string | null;
  timestamp: string;
}

export class DatabaseManager {
  private pool: Pool;

  constructor() {
    // Connection configuration
    this.pool = new Pool({
      host: process.env.PGHOST || '127.0.0.1',  // Use IPv4 explicitly
      port: parseInt(process.env.PGPORT || '5432'),
      database: process.env.PGDATABASE || 'helm',
      user: process.env.PGUSER || process.env.USER,
      password: process.env.PGPASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.initialize().catch(err => {
      console.error('Database initialization failed:', err);
    });
  }

  private async initialize(): Promise<void> {
    const client = await this.pool.connect();

    try {
      // Create tables if they don't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMP,
          working_dir TEXT NOT NULL,
          shell TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS commands (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          input TEXT NOT NULL,
          working_dir TEXT NOT NULL,
          timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
          exit_code INTEGER,
          claude_suggested BOOLEAN NOT NULL DEFAULT false,
          output TEXT
        );

        CREATE TABLE IF NOT EXISTS explanations (
          id SERIAL PRIMARY KEY,
          command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
          summary TEXT NOT NULL,
          breakdown JSONB NOT NULL,
          expected_outcome TEXT NOT NULL,
          failure_modes JSONB,
          undo_guidance TEXT
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
          id SERIAL PRIMARY KEY,
          command_id INTEGER NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          notes TEXT,
          tags JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lessons (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS cli_sessions (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
          program_id TEXT NOT NULL,
          program_name TEXT NOT NULL,
          program_color TEXT NOT NULL DEFAULT '#888',
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cli_inputs (
          id SERIAL PRIMARY KEY,
          cli_session_id INTEGER NOT NULL REFERENCES cli_sessions(id) ON DELETE CASCADE,
          input TEXT NOT NULL,
          output_preview TEXT,
          timestamp TIMESTAMP NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_command ON bookmarks(command_id);
        CREATE INDEX IF NOT EXISTS idx_explanations_command ON explanations(command_id);
        CREATE INDEX IF NOT EXISTS idx_cli_sessions_session ON cli_sessions(session_id);
        CREATE INDEX IF NOT EXISTS idx_cli_inputs_cli_session ON cli_inputs(cli_session_id);
      `);

      console.log('✅ PostgreSQL database initialized');
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createSession(shell: string, workingDir: string): Promise<number> {
    const result = await this.pool.query(
      'INSERT INTO sessions (shell, working_dir) VALUES ($1, $2) RETURNING id',
      [shell, workingDir]
    );
    return result.rows[0].id;
  }

  async endSession(sessionId: number): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET ended_at = NOW() WHERE id = $1',
      [sessionId]
    );
  }

  async reopenSession(sessionId: number): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET ended_at = NULL WHERE id = $1',
      [sessionId]
    );
  }

  async updateSessionWorkingDir(sessionId: number, workingDir: string): Promise<void> {
    await this.pool.query(
      'UPDATE sessions SET working_dir = $2 WHERE id = $1',
      [sessionId, workingDir]
    );
  }

  /** Find the most recent unclosed session, or a recently closed one (within 5 min) to reattach to */
  async getReattachableSession(): Promise<{ id: number; working_dir: string } | null> {
    // First try: unclosed session with commands
    let result = await this.pool.query(`
      SELECT s.id, s.working_dir FROM sessions s
      WHERE s.ended_at IS NULL
        AND EXISTS (SELECT 1 FROM commands c WHERE c.session_id = s.id)
      ORDER BY s.started_at DESC LIMIT 1
    `);
    if (result.rows[0]) return result.rows[0];

    // Second try: recently closed session (within last 5 minutes) with commands
    result = await this.pool.query(`
      SELECT s.id, s.working_dir FROM sessions s
      WHERE s.ended_at > NOW() - INTERVAL '5 minutes'
        AND EXISTS (SELECT 1 FROM commands c WHERE c.session_id = s.id)
      ORDER BY s.ended_at DESC LIMIT 1
    `);
    return result.rows[0] || null;
  }

  /** Clean up on startup: delete empty sessions, but leave sessions with commands intact for reattachment */
  async closeOrphanedSessions(): Promise<void> {
    // Delete sessions that never had any commands
    await this.pool.query(`
      DELETE FROM sessions
      WHERE id NOT IN (SELECT DISTINCT session_id FROM commands)
    `);
  }

  async saveCommand(
    sessionId: number,
    input: string,
    output: string,
    workingDir: string,
    claudeSuggested: boolean
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO commands (session_id, input, output, working_dir, claude_suggested)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sessionId, input, output, workingDir, claudeSuggested]
    );
    return result.rows[0].id;
  }

  async saveExplanation(
    commandId: number,
    summary: string,
    breakdown: string[],
    expectedOutcome: string,
    failureModes: string[],
    undoGuidance: string | null
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO explanations (command_id, summary, breakdown, expected_outcome, failure_modes, undo_guidance)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [commandId, summary, JSON.stringify(breakdown), expectedOutcome, JSON.stringify(failureModes), undoGuidance]
    );
    return result.rows[0].id;
  }

  async getCommands(sessionId?: number): Promise<Command[]> {
    if (sessionId) {
      const result = await this.pool.query(
        'SELECT * FROM commands WHERE session_id = $1 ORDER BY timestamp DESC',
        [sessionId]
      );
      return result.rows;
    } else {
      const result = await this.pool.query(
        'SELECT * FROM commands ORDER BY timestamp DESC LIMIT 100'
      );
      return result.rows;
    }
  }

  async getGroupedCommands(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT
        input,
        COUNT(*)::int AS use_count,
        MAX(timestamp) AS last_used,
        MIN(id) AS id,
        MAX(working_dir) AS working_dir,
        BOOL_OR(claude_suggested) AS claude_suggested
      FROM commands
      GROUP BY input
      ORDER BY MAX(timestamp) DESC
      LIMIT 100
    `);
    return result.rows;
  }

  async getCommand(commandId: number): Promise<Command | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM commands WHERE id = $1',
      [commandId]
    );
    return result.rows[0];
  }

  async bookmarkCommand(
    commandId: number,
    title: string,
    notes?: string,
    tags?: string[]
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO bookmarks (command_id, title, notes, tags)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [commandId, title, notes || null, tags ? JSON.stringify(tags) : null]
    );
    return result.rows[0].id;
  }

  async unbookmarkCommand(commandId: number): Promise<void> {
    await this.pool.query('DELETE FROM bookmarks WHERE command_id = $1', [commandId]);
  }

  async getBookmarkedCommandIds(): Promise<number[]> {
    const result = await this.pool.query('SELECT DISTINCT command_id FROM bookmarks');
    return result.rows.map(r => r.command_id);
  }

  async getBookmarks(): Promise<Bookmark[]> {
    const result = await this.pool.query(`
      SELECT b.*, row_to_json(c.*) as command
      FROM bookmarks b
      JOIN commands c ON b.command_id = c.id
      ORDER BY b.created_at DESC
    `);
    return result.rows;
  }

  async saveLesson(title: string, description: string, sessionId: number): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO lessons (title, description, session_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [title, description, sessionId]
    );
    return result.rows[0].id;
  }

  async getLessons(): Promise<Lesson[]> {
    const result = await this.pool.query(`
      SELECT l.*, COUNT(c.id) as command_count
      FROM lessons l
      LEFT JOIN commands c ON c.session_id = l.session_id
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `);
    return result.rows;
  }

  async getSessions(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT
        s.id,
        s.started_at,
        s.ended_at,
        s.shell,
        s.working_dir,
        COUNT(c.id)::int AS command_count,
        ARRAY(
          SELECT DISTINCT input FROM commands
          WHERE session_id = s.id
          ORDER BY input LIMIT 5
        ) AS top_commands,
        MAX(c.timestamp) AS last_activity
      FROM sessions s
      LEFT JOIN commands c ON c.session_id = s.id
      GROUP BY s.id
      ORDER BY s.started_at DESC
      LIMIT 50
    `);
    return result.rows;
  }

  async getSessionCommands(sessionId: number): Promise<Command[]> {
    const result = await this.pool.query(
      'SELECT * FROM commands WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId]
    );
    return result.rows;
  }

  async getExplainedCommandInputs(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT c.input FROM explanations e JOIN commands c ON e.command_id = c.id`
    );
    return result.rows.map(r => r.input);
  }

  async getExplanation(commandInput: string): Promise<any | null> {
    const result = await this.pool.query(
      `SELECT e.* FROM explanations e
       JOIN commands c ON e.command_id = c.id
       WHERE c.input = $1
       ORDER BY e.id DESC LIMIT 1`,
      [commandInput]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      summary: row.summary,
      breakdown: row.breakdown,
      expectedOutcome: row.expected_outcome,
      failureModes: row.failure_modes,
      undoGuidance: row.undo_guidance,
    };
  }

  async deleteSession(sessionId: number): Promise<void> {
    // Delete related data first (foreign key constraints)
    await this.pool.query('DELETE FROM cli_inputs WHERE cli_session_id IN (SELECT id FROM cli_sessions WHERE session_id = $1)', [sessionId]);
    await this.pool.query('DELETE FROM cli_sessions WHERE session_id = $1', [sessionId]);
    await this.pool.query('DELETE FROM explanations WHERE command_id IN (SELECT id FROM commands WHERE session_id = $1)', [sessionId]);
    await this.pool.query('DELETE FROM bookmarks WHERE command_id IN (SELECT id FROM commands WHERE session_id = $1)', [sessionId]);
    await this.pool.query('DELETE FROM commands WHERE session_id = $1', [sessionId]);
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  // ── CLI Session / Input tracking ──────────────────────────────────

  async createCLISession(
    sessionId: number,
    commandId: number | null,
    programId: string,
    programName: string,
    programColor: string
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO cli_sessions (session_id, command_id, program_id, program_name, program_color)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sessionId, commandId, programId, programName, programColor]
    );
    return result.rows[0].id;
  }

  async endCLISession(cliSessionId: number): Promise<void> {
    await this.pool.query(
      'UPDATE cli_sessions SET ended_at = NOW() WHERE id = $1',
      [cliSessionId]
    );
  }

  async saveCLIInput(
    cliSessionId: number,
    input: string,
    outputPreview?: string
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO cli_inputs (cli_session_id, input, output_preview)
       VALUES ($1, $2, $3) RETURNING id`,
      [cliSessionId, input, outputPreview || null]
    );
    return result.rows[0].id;
  }

  async getCLISessions(sessionId: number): Promise<CLISession[]> {
    const result = await this.pool.query(`
      SELECT cs.*,
        COUNT(ci.id)::int AS input_count
      FROM cli_sessions cs
      LEFT JOIN cli_inputs ci ON ci.cli_session_id = cs.id
      WHERE cs.session_id = $1
      GROUP BY cs.id
      ORDER BY cs.started_at ASC
    `, [sessionId]);
    return result.rows;
  }

  async getCLIInputs(cliSessionId: number): Promise<CLIInput[]> {
    const result = await this.pool.query(
      'SELECT * FROM cli_inputs WHERE cli_session_id = $1 ORDER BY timestamp ASC',
      [cliSessionId]
    );
    return result.rows;
  }

  /**
   * Returns session commands interleaved with CLI session markers.
   * Each command that launched a CLI program gets a `cli_session` field
   * attached with its inputs.
   */
  async getSessionCommandsWithCLI(sessionId: number): Promise<any[]> {
    // Get all commands for the session
    const commands = await this.getSessionCommands(sessionId);

    // Get all CLI sessions for this session
    const cliSessions = await this.getCLISessions(sessionId);

    // For each CLI session, fetch its inputs
    const cliSessionMap = new Map<number, any>();
    for (const cs of cliSessions) {
      const inputs = await this.getCLIInputs(cs.id);
      cliSessionMap.set(cs.command_id!, { ...cs, inputs });
    }

    // Attach CLI session data to matching commands
    return commands.map(cmd => {
      const cliData = cliSessionMap.get(cmd.id);
      if (cliData) {
        return { ...cmd, cli_session: cliData };
      }
      return cmd;
    });
  }

  async getRecentCLIInputs(limit: number = 50): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT ci.*, cs.program_id, cs.program_name, cs.program_color
      FROM cli_inputs ci
      JOIN cli_sessions cs ON ci.cli_session_id = cs.id
      ORDER BY ci.timestamp DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  }

  async clearHistory(): Promise<void> {
    await this.pool.query('DELETE FROM cli_inputs');
    await this.pool.query('DELETE FROM cli_sessions');
    await this.pool.query('DELETE FROM explanations');
    await this.pool.query('DELETE FROM bookmarks');
    await this.pool.query('DELETE FROM commands');
    await this.pool.query('DELETE FROM lessons');
    await this.pool.query('DELETE FROM sessions');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
