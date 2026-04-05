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

export interface PendingTabContext {
  /** Absolute directory to start the shell in */
  cwd?: string;
  /** Env var overrides to merge into the PTY env */
  env?: Record<string, string>;
  /** Commands to seed into shell history (user can press ↑ to recall) */
  history?: string[];
  /** Command to run immediately after the shell starts */
  initialCommand?: string;
  /** Origin: 'snapshot' | 'open' | 'run' */
  source?: string;
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
  public cliWatcher: CLIConversationWatcher;
  private hasReattached = false;
  private cliStatusCallbacks: Array<(tabId: string, active: boolean, programName?: string) => void> = [];
  private commandCapturedCallbacks: Array<(tabId: string, command: string) => void> = [];
  /** Context to apply when a specific tabId's PTY is next started (set via `helm` CLI) */
  private pendingContexts: Map<string, PendingTabContext> = new Map();

  /** Register a context to be applied the next time start() runs for the given tabId */
  setPendingContext(tabId: string, ctx: PendingTabContext): void {
    this.pendingContexts.set(tabId, ctx);
  }

  /** Register callback for CLI program start/stop events */
  onCLIStatus(callback: (tabId: string, active: boolean, programName?: string) => void): void {
    this.cliStatusCallbacks.push(callback);
  }

  /** Register callback fired when a shell command is captured from user input */
  onCommandCaptured(callback: (tabId: string, command: string) => void): void {
    this.commandCapturedCallbacks.push(callback);
  }

  private tabHistoryDir: string;

  constructor(private db: DatabaseManager, customRegistry?: CLIProgram[]) {
    this.cliWatcher = new CLIConversationWatcher(db);
    this.cliRegistry = customRegistry || DEFAULT_CLI_REGISTRY;

    const homeDir = process.env.HOME || os.homedir();
    this.zshEnvDir = path.join(homeDir, '.helm');

    // Per-tab histfiles live here so snapshot-captured history can appear
    // in a new tab's ↑-arrow recall without polluting ~/.zsh_history.
    this.tabHistoryDir = path.join(homeDir, 'Library', 'Application Support', 'Helm', 'tab-histories');
    try {
      if (!fs.existsSync(this.tabHistoryDir)) {
        fs.mkdirSync(this.tabHistoryDir, { recursive: true, mode: 0o700 });
      }
    } catch {}

    // Create zsh env files once
    if (!fs.existsSync(this.zshEnvDir)) fs.mkdirSync(this.zshEnvDir, { recursive: true });
    fs.writeFileSync(path.join(this.zshEnvDir, '.zshenv'), [
      'unsetopt PROMPT_CR PROMPT_SP 2>/dev/null',
      `[ -f "${homeDir}/.zshenv" ] && source "${homeDir}/.zshenv"`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(this.zshEnvDir, '.zshrc'), [
      `[ -f "${homeDir}/.zshrc" ] && source "${homeDir}/.zshrc"`,
      '# HELM: restore per-tab HISTFILE if user .zshrc reset it',
      '[ -n "$HELM_TAB_HISTFILE" ] && export HISTFILE="$HELM_TAB_HISTFILE"',
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

    // Apply pending context from `helm` CLI, if any
    const pending = this.pendingContexts.get(tabId);
    if (pending) this.pendingContexts.delete(tabId);

    const spawnCwd = pending?.cwd && fs.existsSync(pending.cwd) ? pending.cwd : homeDir;

    // Build a per-tab histfile: [user's main history] + [captured snapshot entries].
    // This is set as HISTFILE on the PTY so the new tab's ↑-arrow recalls the
    // captured commands first (most recent), then cycles into the user's history.
    // The user's ~/.zsh_history is never modified.
    let perTabHistFile: string | null = null;
    if (pending?.history && pending.history.length > 0) {
      try {
        perTabHistFile = this.buildTabHistoryFile(tabId, shell, pending.history);
      } catch (err) {
        console.warn('Failed to build per-tab history file:', err);
      }
    }

    console.log(`🔧 Starting PTY for tab ${tabId}:`, { shell, cols, rows, cwd: spawnCwd });

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: spawnCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOME: homeDir,
        SHELL: shell,
        SHELL_SESSIONS_DISABLE: '1',
        PROMPT_EOL_MARK: '',
        ZDOTDIR: this.zshEnvDir,
        ...(pending?.env || {}),
        ...(perTabHistFile ? { HISTFILE: perTabHistFile, HELM_TAB_HISTFILE: perTabHistFile } : {}),
      } as any,
    });

    // If the context asked to run a command, send it once the shell has
    // emitted its first prompt (see onData handler below for the trigger).
    const pendingInitialCommand = pending?.initialCommand || null;
    let initialCommandSent = false;
    // Safety net: if we never see a prompt (e.g. unusual shell config),
    // fire the command after 3s anyway so the user isn't left hanging.
    if (pendingInitialCommand) {
      setTimeout(() => {
        if (!initialCommandSent) {
          initialCommandSent = true;
          try { ptyProcess.write(pendingInitialCommand + '\r'); } catch {}
        }
      }, 3000);
    }

    console.log(`✅ PTY started for tab ${tabId}, PID:`, ptyProcess.pid);

    // First tab on startup: try to reattach to a recent session.
    // Additional tabs always get a new session.
    let sessionId: number;
    let workingDir = spawnCwd;
    if (!this.hasReattached) {
      this.hasReattached = true;
      const reattachable = await this.db.getReattachableSession();
      if (reattachable) {
        sessionId = reattachable.id;
        workingDir = reattachable.working_dir;
        await this.db.reopenSession(sessionId);
        console.log(`🔄 Reattached to session ${sessionId} (${workingDir})`);
      } else {
        sessionId = await this.db.createSession(ptyProcess.process, spawnCwd);
        console.log(`🆕 Created new session ${sessionId}`);
      }
    } else {
      sessionId = await this.db.createSession(ptyProcess.process, spawnCwd);
      console.log(`🆕 Created new session ${sessionId} (new tab)`);
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

          // Now that the shell is ready, run any queued initial command
          if (pendingInitialCommand && !initialCommandSent) {
            initialCommandSent = true;
            try { ptyProcess.write(pendingInitialCommand + '\r'); } catch {}
          }
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
      this.cleanupTabHistoryFile(tabId);
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
      this.cleanupTabHistoryFile(tabId);
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
      this.cleanupTabHistoryFile(tabId);
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
  /** Find which tab a CLI session belongs to */
  getTabForCLISession(cliSessionId: number): string | null {
    for (const [tabId, instance] of this.instances) {
      if (instance.activeCLI?.cliSessionId === cliSessionId) {
        return tabId;
      }
    }
    return null;
  }

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
    for (const cb of this.cliStatusCallbacks) { try { cb(tabId, true, program.name); } catch {} }

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
    for (const cb of this.cliStatusCallbacks) { try { cb(tabId, false, cli.program.name); } catch {} }

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
    // Clear immediately to prevent re-entrant double-capture when another
    // \r/\n arrives from the PTY while we're awaiting saveCommand.
    instance.currentCommand = '';
    if (!trimmedCommand || trimmedCommand.length < 2) {
      return;
    }

    const cleaned = trimmedCommand
      .replace(/\x1b\[[0-9;?]*[a-zA-Z@`]/g, '')  // CSI sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')  // OSC sequences
      .replace(/\x1b[()#][A-Za-z0-9]/g, '')  // Charset sequences
      .replace(/\x1b[>=<78DEHM]/g, '')  // Other escape sequences
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')  // Control chars
      .replace(/\x1b/g, '')  // Any remaining ESC
      .trim();
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

    // Notify renderer about the captured command (for Command Blocks, etc.)
    for (const cb of this.commandCapturedCallbacks) {
      try { cb(tabId, cleaned); } catch {}
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

    instance.outputBuffer = '';
  }

  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  }

  /**
   * Build a per-tab histfile combining the user's main history with
   * snapshot-captured entries, so the tab's ↑-arrow recall shows captured
   * entries first (most recent) then cycles into the user's normal history.
   * Returns the path to the per-tab histfile, or null for unsupported shells.
   *
   * The user's main histfile is never modified.
   */
  private buildTabHistoryFile(tabId: string, shell: string, entries: string[]): string | null {
    const home = process.env.HOME || os.homedir();
    const isZsh = /zsh$/.test(shell);
    const isBash = /bash$/.test(shell);
    if (!isZsh && !isBash) return null;

    const mainHistfile = isZsh
      ? (process.env.HISTFILE || path.join(home, '.zsh_history'))
      : (process.env.HISTFILE || path.join(home, '.bash_history'));

    const perTabPath = path.join(
      this.tabHistoryDir,
      `${tabId}.${isZsh ? 'zsh' : 'bash'}_history`
    );

    // Read the user's main history (tolerate missing or unreadable file)
    let mainContent = '';
    try {
      if (fs.existsSync(mainHistfile)) {
        mainContent = fs.readFileSync(mainHistfile, 'utf-8');
        if (!mainContent.endsWith('\n')) mainContent += '\n';
      }
    } catch { /* ignore — we'll just have captured entries */ }

    // Format the captured entries (appended = most recent in zsh/bash)
    const now = Math.floor(Date.now() / 1000);
    const capturedLines = entries.map((cmd, i) => {
      const clean = cmd.replace(/\r/g, '').replace(/\n/g, ' ').trim();
      if (!clean) return '';
      if (isZsh) {
        // zsh extended history format: ": <epoch>:<duration>;<cmd>"
        // Use timestamps newer than anything in the main history so they rank as "most recent"
        return `: ${now - (entries.length - i) + entries.length}:0;${clean}`;
      }
      return clean;
    }).filter(Boolean);

    if (capturedLines.length === 0) return null;

    const combined = mainContent + capturedLines.join('\n') + '\n';
    fs.writeFileSync(perTabPath, combined, { mode: 0o600 });
    return perTabPath;
  }

  /** Remove the per-tab histfile for a tab (call on tab close) */
  private cleanupTabHistoryFile(tabId: string): void {
    try {
      for (const ext of ['zsh_history', 'bash_history']) {
        const p = path.join(this.tabHistoryDir, `${tabId}.${ext}`);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    } catch {}
  }
}
