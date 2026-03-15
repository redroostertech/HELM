import * as pty from 'node-pty';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseManager } from './database';

interface PTYInstance {
  process: pty.IPty;
  sessionId: number | null;
  currentCommand: string;
  outputBuffer: string;
  recentCommands: string[];
}

export class PTYManager {
  private instances: Map<string, PTYInstance> = new Map();
  private zshEnvDir: string;

  constructor(private db: DatabaseManager) {
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

    const sessionId = await this.db.createSession(ptyProcess.process, homeDir);

    const instance: PTYInstance = {
      process: ptyProcess,
      sessionId,
      currentCommand: '',
      outputBuffer: '',
      recentCommands: [],
    };

    this.instances.set(tabId, instance);

    // Capture commands
    ptyProcess.onData((data) => {
      instance.outputBuffer += data;
      if (data.includes('\r') || data.includes('\n')) {
        this.captureCommand(tabId);
      }
    });

    ptyProcess.onExit(() => {
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
    instance.currentCommand += data;
    instance.process.write(data);
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.instances.get(tabId)?.process.resize(cols, rows);
  }

  kill(tabId: string): void {
    const instance = this.instances.get(tabId);
    if (instance) {
      instance.process.kill();
      this.instances.delete(tabId);
    }
  }

  killAll(): void {
    for (const [tabId, instance] of this.instances) {
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

  getMemoryUsage(tabId: string): number {
    const instance = this.instances.get(tabId);
    if (!instance) return 0;
    try {
      // Read /proc/<pid>/status or use ps on macOS
      const { execSync } = require('child_process');
      const result = execSync(`ps -o rss= -p ${instance.process.pid} 2>/dev/null`, { encoding: 'utf-8' });
      const kb = parseInt(result.trim(), 10);
      return isNaN(kb) ? 0 : kb / 1024; // convert to MB
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

  private async captureCommand(tabId: string): Promise<void> {
    const instance = this.instances.get(tabId);
    if (!instance || !instance.sessionId) return;

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

    await this.db.saveCommand(
      instance.sessionId,
      cleaned,
      instance.outputBuffer,
      process.cwd(),
      false
    );

    instance.currentCommand = '';
    instance.outputBuffer = '';
  }
}
