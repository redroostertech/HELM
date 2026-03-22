/**
 * CLI Conversation Watcher
 *
 * Watches CLI programs' local conversation files for new messages.
 * Currently supports Claude Code, which stores conversations in:
 *   ~/.claude/sessions/<pid>.json        — session metadata
 *   ~/.claude/projects/<project>/<id>.jsonl — full conversation
 *   ~/.claude/history.jsonl              — user prompt history
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from './database';

interface ClaudeCodeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
}

interface ConversationEntry {
  type: 'user' | 'assistant';
  content: string;
  timestamp: string;
  uuid?: string;
  parentUuid?: string;
}

export class CLIConversationWatcher {
  private watchers: Map<number, fs.FSWatcher> = new Map(); // cliSessionId -> watcher
  private lastReadPosition: Map<string, number> = new Map(); // filePath -> byte offset
  private claudeDir: string;
  private pollIntervals: Map<number, NodeJS.Timeout> = new Map();

  constructor(private db: DatabaseManager) {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Start watching for a Claude Code session.
   * Called when the PTY manager detects `claude` was launched.
   */
  async startWatching(cliSessionId: number, ptyPid: number): Promise<void> {
    // Claude Code spawns as a child of the shell, so we need to find its PID
    // Wait a moment for Claude Code to create its session file
    setTimeout(() => this.findAndWatch(cliSessionId, ptyPid), 2000);
  }

  /**
   * Find the Claude Code session file and start watching the conversation.
   */
  private async findAndWatch(cliSessionId: number, ptyPid: number): Promise<void> {
    const sessionsDir = path.join(this.claudeDir, 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      console.log('⚠️ Claude Code sessions directory not found');
      return;
    }

    // Find the most recent session file (Claude Code creates one per session)
    const sessionFiles = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (sessionFiles.length === 0) {
      console.log('⚠️ No Claude Code session files found');
      return;
    }

    // Use the most recently modified session file
    const latestFile = sessionFiles[0];
    let sessionMeta: ClaudeCodeSession;
    try {
      sessionMeta = JSON.parse(fs.readFileSync(latestFile.path, 'utf-8'));
    } catch {
      console.log('⚠️ Failed to parse Claude Code session file');
      return;
    }

    console.log(`📂 Found Claude Code session: ${sessionMeta.sessionId} (PID ${sessionMeta.pid})`);

    // Find the conversation JSONL file
    const projectDir = this.findProjectDir(sessionMeta.cwd);
    if (!projectDir) {
      console.log('⚠️ Claude Code project directory not found, falling back to history.jsonl');
      this.watchHistoryFile(cliSessionId, sessionMeta.sessionId);
      return;
    }

    const conversationFile = path.join(projectDir, `${sessionMeta.sessionId}.jsonl`);
    if (!fs.existsSync(conversationFile)) {
      console.log(`⚠️ Conversation file not found: ${conversationFile}, waiting...`);
      // File might not exist yet, poll for it
      const checkInterval = setInterval(() => {
        if (fs.existsSync(conversationFile)) {
          clearInterval(checkInterval);
          this.watchConversationFile(cliSessionId, conversationFile);
        }
      }, 1000);
      // Stop checking after 30 seconds
      setTimeout(() => clearInterval(checkInterval), 30000);
      return;
    }

    this.watchConversationFile(cliSessionId, conversationFile);
  }

  /**
   * Find the Claude Code project directory for a given cwd.
   * Claude Code uses the pattern: ~/.claude/projects/<cwd-with-dashes>/
   */
  private findProjectDir(cwd: string): string | null {
    const projectsDir = path.join(this.claudeDir, 'projects');
    if (!fs.existsSync(projectsDir)) return null;

    // Claude Code encodes the path: /Users/foo/bar -> -Users-foo-bar
    const encoded = cwd.replace(/\//g, '-');

    const fullPath = path.join(projectsDir, encoded);
    if (fs.existsSync(fullPath)) return fullPath;

    // Try variations (with or without leading dash)
    const withLeading = path.join(projectsDir, `-${encoded.replace(/^-/, '')}`);
    if (fs.existsSync(withLeading)) return withLeading;

    return null;
  }

  /**
   * Watch a Claude Code conversation JSONL file for new entries.
   * This file contains both user messages and assistant responses.
   */
  private watchConversationFile(cliSessionId: number, filePath: string): void {
    console.log(`👁️ Watching conversation file: ${filePath}`);

    // Record current file size so we only read new content
    const stats = fs.statSync(filePath);
    this.lastReadPosition.set(filePath, stats.size);

    // Poll the file for changes (more reliable than fs.watch for JSONL appends)
    const interval = setInterval(() => {
      this.readNewEntries(cliSessionId, filePath);
    }, 2000);

    this.pollIntervals.set(cliSessionId, interval);
  }

  /**
   * Read new entries appended to the conversation file since last read.
   */
  private async readNewEntries(cliSessionId: number, filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    const lastPos = this.lastReadPosition.get(filePath) || 0;

    if (stats.size <= lastPos) return; // No new data

    // Read only the new portion
    const fd = fs.openSync(filePath, 'r');
    const newBytes = stats.size - lastPos;
    const buffer = Buffer.alloc(newBytes);
    fs.readSync(fd, buffer, 0, newBytes, lastPos);
    fs.closeSync(fd);

    this.lastReadPosition.set(filePath, stats.size);

    const newContent = buffer.toString('utf-8');
    const lines = newContent.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        await this.processConversationEntry(cliSessionId, entry);
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Process a single conversation entry and save to the database.
   */
  private async processConversationEntry(cliSessionId: number, entry: any): Promise<void> {
    if (!entry.message) return;

    const role = entry.message.role || entry.type;
    const timestamp = entry.timestamp || new Date().toISOString();

    if (role === 'user') {
      // Extract user message content
      const content = typeof entry.message.content === 'string'
        ? entry.message.content
        : Array.isArray(entry.message.content)
          ? entry.message.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n')
          : '';

      if (!content.trim()) return;

      // Save as CLI input
      const inputId = await this.db.saveCLIInput(cliSessionId, content.trim());
      console.log(`📝 Claude Code input: "${content.trim().slice(0, 80)}"`);

    } else if (role === 'assistant') {
      // Extract assistant response text
      const content = Array.isArray(entry.message.content)
        ? entry.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n')
        : typeof entry.message.content === 'string'
          ? entry.message.content
          : '';

      if (!content.trim()) return;

      // Find the most recent input for this CLI session and attach the response
      const inputs = await this.db.getCLIInputs(cliSessionId);
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        if (!lastInput.output_preview) {
          await this.db.updateCLIInputResponse(lastInput.id, content.trim());
          console.log(`💬 Claude Code response saved (${content.trim().length} chars)`);
        }
      }
    }
  }

  /**
   * Fallback: watch ~/.claude/history.jsonl for user prompts only.
   * This doesn't capture responses but at least gets the inputs.
   */
  private watchHistoryFile(cliSessionId: number, claudeSessionId: string): void {
    const historyFile = path.join(this.claudeDir, 'history.jsonl');
    if (!fs.existsSync(historyFile)) return;

    console.log(`👁️ Watching history file (fallback): ${historyFile}`);

    const stats = fs.statSync(historyFile);
    this.lastReadPosition.set(historyFile, stats.size);

    const interval = setInterval(() => {
      this.readNewHistoryEntries(cliSessionId, historyFile, claudeSessionId);
    }, 2000);

    this.pollIntervals.set(cliSessionId, interval);
  }

  private async readNewHistoryEntries(
    cliSessionId: number,
    filePath: string,
    claudeSessionId: string
  ): Promise<void> {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    const lastPos = this.lastReadPosition.get(filePath) || 0;
    if (stats.size <= lastPos) return;

    const fd = fs.openSync(filePath, 'r');
    const newBytes = stats.size - lastPos;
    const buffer = Buffer.alloc(newBytes);
    fs.readSync(fd, buffer, 0, newBytes, lastPos);
    fs.closeSync(fd);

    this.lastReadPosition.set(filePath, stats.size);

    const lines = buffer.toString('utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Only capture entries for this specific Claude session
        if (entry.sessionId === claudeSessionId && entry.display) {
          await this.db.saveCLIInput(cliSessionId, entry.display);
          console.log(`📝 Claude Code input (history): "${entry.display.slice(0, 80)}"`);
        }
      } catch {}
    }
  }

  /**
   * Stop watching for a CLI session.
   */
  stopWatching(cliSessionId: number): void {
    const watcher = this.watchers.get(cliSessionId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(cliSessionId);
    }

    const interval = this.pollIntervals.get(cliSessionId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(cliSessionId);
    }
  }

  /**
   * Stop all watchers.
   */
  stopAll(): void {
    for (const [id] of this.watchers) {
      this.stopWatching(id);
    }
    for (const [id, interval] of this.pollIntervals) {
      clearInterval(interval);
    }
    this.pollIntervals.clear();
  }
}
