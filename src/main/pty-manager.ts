import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from './database';
import { CLIProgram, DEFAULT_CLI_REGISTRY, detectCLIProgram } from './cli-registry';
import { CLIConversationWatcher } from './cli-watcher';

interface ActiveCLI {
  program: CLIProgram;
  cliSessionId: number;
  startedAt: Date;
  /** Timestamp of last user input — used to avoid premature exit detection */
  lastInputTime: number;
}

interface PTYInstance {
  process: pty.IPty;
  sessionId: number | null;
  /** Stored for deferred session creation */
  shell: string;
  workingDir: string;
  currentCommand: string;
  outputBuffer: string;
  recentCommands: string[];
  activeCLI: ActiveCLI | null;
  /** Captured shell prompt pattern from initial output, for exit detection */
  shellPromptSample: string | null;
}

export class PTYManager {
  private instances: Map<string, PTYInstance> = new Map();
  private zshEnvDir: string;
  private cliRegistry: CLIProgram[];
  private cliWatcher: CLIConversationWatcher;

  constructor(private db: DatabaseManager, customRegistry?: CLIProgram[]) {
    this.cliWatcher = new CLIConversationWatcher(db);
    this.cliRegistry = customRegistry || DEFAULT_CLI_REGISTRY;

    const homeDir = process.env.HOME || os.homedir();
    this.zshEnvDir = path.join(homeDir, '.helm');

    // Create zsh env files once
    if (!fs.existsSync(this.zshEnvDir)) fs.mkdirSync(this.zshEnvDir, { recursive: true });
    fs.writeFileSync(path.join(this.zshEnvDir, '.zshenv'), [
      'unsetopt PROMPT_CR PROMPT_SP 2>/dev/null',
      `[ -f "${homeDir}/.zshenv" ] && source "${homeDir}/.zshenv"`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(this.zshEnvDir, '.zshrc'), [
      `[ -f "${homeDir}/.zshrc" ] && source "${homeDir}/.zshrc"`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(this.zshEnvDir, '.zprofile'), [
      `[ -f "${homeDir}/.zprofile" ] && source "${homeDir}/.zprofile"`,
      '',
    ].join('\n'));
  }

  async start(tabId: string, cols: number, rows: number): Promise<{ pid: number; isNew: boolean }> {
    // If this tab already has a PTY, return it
    const existing = this.instances.get(tabId);
    if (existing) {
      console.log(`⚠️ PTY already started for tab ${tabId}, skipping`);
      return { pid: existing.process.pid, isNew: false };
    }

    const shell = process.env.SHELL || '/bin/zsh';
    const homeDir = process.env.HOME || os.homedir();

    console.log(`🔧 Starting PTY for tab ${tabId}:`, { shell, cols, rows });

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: homeDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOME: homeDir,
        SHELL: shell,
        SHELL_SESSIONS_DISABLE: '1',
        PROMPT_EOL_MARK: '',
        ZDOTDIR: this.zshEnvDir,
      } as any,
    });

    console.log(`✅ PTY started for tab ${tabId}, PID:`, ptyProcess.pid);

    // Try to reattach to a recent session, otherwise create a new one
    let sessionId: number;
    let workingDir = homeDir;
    const reattachable = await this.db.getReattachableSession();
    if (reattachable) {
      sessionId = reattachable.id;
      workingDir = reattachable.working_dir;
      await this.db.reopenSession(sessionId);
      console.log(`🔄 Reattached to session ${sessionId} (${workingDir})`);
    } else {
      sessionId = await this.db.createSession(ptyProcess.process, homeDir);
      console.log(`🆕 Created new session ${sessionId}`);
    }

    const instance: PTYInstance = {
      process: ptyProcess,
      sessionId,
      shell: ptyProcess.process,
      workingDir,
      currentCommand: '',
      outputBuffer: '',
      recentCommands: [],
      activeCLI: null,
      shellPromptSample: null,
    };

    this.instances.set(tabId, instance);

    // Capture commands and detect CLI programs
    let initialOutputCapture = '';
    let hasSeenFirstPrompt = false;

    ptyProcess.onData((data) => {
      // Capture the shell prompt pattern from initial output
      if (!hasSeenFirstPrompt) {
        initialOutputCapture += data;
        // After initial shell startup, capture the prompt
        const stripped = this.stripAnsi(initialOutputCapture);
        const lines = stripped.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          // Store the last line as the shell prompt sample
          instance.shellPromptSample = lines[lines.length - 1].trim();
          hasSeenFirstPrompt = true;
        }
      }

      if (instance.activeCLI) {
        // In CLI mode: conversation capture is handled by CLIConversationWatcher.
        // Here we only check for exit detection.

        // Check if CLI program has exited (shell prompt reappeared)
        // Only check after a minimum time since last input to avoid false positives
        const timeSinceInput = Date.now() - instance.activeCLI.lastInputTime;
        if (timeSinceInput > 500 && this.detectCLIExit(instance, data)) {
          this.endCLISession(tabId);
        }
      } else {
        // Normal shell mode: existing behavior
        instance.outputBuffer += data;
        if (data.includes('\r') || data.includes('\n')) {
          this.captureCommand(tabId);
        }
      }
    });

    ptyProcess.onExit(() => {
      // End any active CLI session
      if (instance.activeCLI) {
        this.db.endCLISession(instance.activeCLI.cliSessionId).catch(() => {});
      }
      if (instance.sessionId) {
        this.db.endSession(instance.sessionId);
      }
      this.instances.delete(tabId);
    });

    return { pid: ptyProcess.pid, isNew: true };
  }

  write(tabId: string, data: string): void {
    const instance = this.instances.get(tabId);
    if (!instance) return;

    if (instance.activeCLI) {
      // In CLI mode: inputs are captured by the file watcher (CLIConversationWatcher),
      // not from write() — TUI programs use raw terminal mode so keystrokes
      // come through as escape sequences, not readable text.
      instance.activeCLI.lastInputTime = Date.now();
    } else {
      // Normal shell mode
      instance.currentCommand += data;
    }

    instance.process.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.instances.get(tabId)?.process.resize(cols, rows);
  }

  kill(tabId: string): void {
    const instance = this.instances.get(tabId);
    if (instance) {
      if (instance.activeCLI) {
        this.db.endCLISession(instance.activeCLI.cliSessionId).catch(() => {});
      }
      instance.process.kill();
      this.instances.delete(tabId);
    }
  }

  killAll(): void {
    this.cliWatcher.stopAll();
    for (const [tabId, instance] of this.instances) {
      if (instance.activeCLI) {
        this.db.endCLISession(instance.activeCLI.cliSessionId).catch(() => {});
      }
      instance.process.kill();
    }
    this.instances.clear();
  }

  onData(tabId: string, callback: (data: string) => void): void {
    this.instances.get(tabId)?.process.onData(callback);
  }

  onExit(tabId: string, callback: (exitCode: number) => void): void {
    this.instances.get(tabId)?.process.onExit(({ exitCode }) => callback(exitCode));
  }

  getRecentCommands(tabId: string): string[] {
    return this.instances.get(tabId)?.recentCommands || [];
  }

  /** Resume a previous session — reattach the current tab to that session */
  resumeSession(tabId: string, sessionId: number, workingDir: string): void {
    const instance = this.instances.get(tabId);
    if (!instance) return;

    // End current session if it exists
    if (instance.sessionId && instance.sessionId !== sessionId) {
      this.db.endSession(instance.sessionId).catch(() => {});
    }

    // Reattach to the resumed session
    instance.sessionId = sessionId;
    instance.workingDir = workingDir;

    // Reopen the session (clear ended_at)
    this.db.reopenSession(sessionId).catch(() => {});

    console.log(`🔄 Tab ${tabId} resumed session ${sessionId}`);
  }

  /** Returns the active CLI program for a tab, if any */
  getActiveCLI(tabId: string): { programId: string; programName: string } | null {
    const cli = this.instances.get(tabId)?.activeCLI;
    if (!cli) return null;
    return { programId: cli.program.id, programName: cli.program.name };
  }

  getMemoryUsage(tabId: string): number {
    const instance = this.instances.get(tabId);
    if (!instance) return 0;
    try {
      const { execSync } = require('child_process');
      const result = execSync(`ps -o rss= -p ${instance.process.pid} 2>/dev/null`, { encoding: 'utf-8' });
      const kb = parseInt(result.trim(), 10);
      return isNaN(kb) ? 0 : kb / 1024;
    } catch {
      return 0;
    }
  }

  getAllMemoryUsage(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const tabId of this.instances.keys()) {
      result[tabId] = this.getMemoryUsage(tabId);
    }
    return result;
  }

  // ── CLI Detection ─────────────────────────────────────────────────

  private startCLISession(tabId: string, program: CLIProgram, commandId: number | null): void {
    const instance = this.instances.get(tabId);
    if (!instance || !instance.sessionId) return;

    // Set activeCLI SYNCHRONOUSLY so the onData handler immediately
    // switches to CLI mode. The cliSessionId is filled in async.
    instance.activeCLI = {
      program,
      cliSessionId: -1,
      startedAt: new Date(),
      lastInputTime: Date.now(),
    };

    console.log(`🔌 CLI detected: ${program.name} in tab ${tabId}`);

    // Create DB record async, then start the file watcher
    this.db.createCLISession(
      instance.sessionId,
      commandId,
      program.id,
      program.name,
      program.color
    ).then((cliSessionId) => {
      if (instance.activeCLI) {
        instance.activeCLI.cliSessionId = cliSessionId;
        console.log(`🔌 CLI session created: ${program.name} (session ${cliSessionId})`);

        // Start watching the CLI program's conversation files
        if (program.id === 'claude-code') {
          this.cliWatcher.startWatching(cliSessionId, instance.process.pid);
        }
      }
    }).catch((err) => {
      console.error('Failed to create CLI session:', err);
    });
  }

  private async endCLISession(tabId: string): Promise<void> {
    const instance = this.instances.get(tabId);
    if (!instance?.activeCLI) return;

    const cli = instance.activeCLI;
    console.log(`🔌 CLI exited: ${cli.program.name} (session ${cli.cliSessionId}) in tab ${tabId}`);

    // Stop watching conversation files
    this.cliWatcher.stopWatching(cli.cliSessionId);

    await this.db.endCLISession(cli.cliSessionId);
    instance.activeCLI = null;

    // Reset shell mode state
    instance.currentCommand = '';
    instance.outputBuffer = '';
  }

  /**
   * Detect if a CLI program has exited by checking if the shell prompt reappeared.
   *
   * Strategy: match against the user's actual shell prompt (captured at startup).
   * The prompt contains user@hostname which is highly specific and unlikely to
   * appear in CLI program output.
   */
  private detectCLIExit(instance: PTYInstance, latestData: string): boolean {
    if (!instance.shellPromptSample) return false;

    const stripped = this.stripAnsi(latestData);
    const lines = stripped.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const trimmed = line.trim();
      if (this.isShellPromptMatch(trimmed, instance.shellPromptSample)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compare a line against the captured shell prompt.
   * Requires the user@hostname pattern to match — this is the most reliable
   * signal that the shell has regained control, since CLI programs don't
   * emit user@host strings in their output.
   */
  private isShellPromptMatch(line: string, promptSample: string): boolean {
    // Exact match (prompt hasn't changed)
    if (line === promptSample) return true;

    // Extract user@host from the prompt sample (e.g. "user@hostname")
    const userHostMatch = promptSample.match(/(\w+@[\w.-]+)/);
    if (!userHostMatch) return false;

    const userHost = userHostMatch[1];

    // Line must contain the same user@host AND end with a shell prompt character
    if (!line.includes(userHost)) return false;

    const promptSuffixes = ['$', '%', '#', '❯', '➜'];
    const lastChar = line[line.length - 1];
    return promptSuffixes.includes(lastChar);
  }

  // ── Existing command capture (shell mode) ─────────────────────────

  private async captureCommand(tabId: string): Promise<void> {
    const instance = this.instances.get(tabId);
    if (!instance) return;

    const trimmedCommand = instance.currentCommand.trim();
    if (!trimmedCommand || trimmedCommand.length < 2) {
      instance.currentCommand = '';
      return;
    }

    const cleaned = trimmedCommand.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim();
    if (!cleaned || cleaned.length < 2) {
      instance.currentCommand = '';
      return;
    }

    // Track recent commands for tab description
    instance.recentCommands.push(cleaned);
    if (instance.recentCommands.length > 5) {
      instance.recentCommands.shift();
    }

    // Track directory changes
    const cdMatch = cleaned.match(/^cd\s+(.+)$/);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^~/, process.env.HOME || '');
      // Resolve relative to current workingDir
      const newDir = path.isAbsolute(target) ? target : path.resolve(instance.workingDir, target);
      if (fs.existsSync(newDir)) {
        instance.workingDir = newDir;
        // Update session's working directory in DB
        if (instance.sessionId) {
          this.db.updateSessionWorkingDir(instance.sessionId, newDir).catch(() => {});
        }
      }
    }

    const commandId = await this.db.saveCommand(
      instance.sessionId!,
      cleaned,
      instance.outputBuffer,
      instance.workingDir,
      false
    );

    // Check if this command launches a known CLI program
    const program = detectCLIProgram(cleaned, this.cliRegistry);
    if (program) {
      this.startCLISession(tabId, program, commandId);
    }

    instance.currentCommand = '';
    instance.outputBuffer = '';
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  }
}
