/**
 * HelmIPCServer — Unix domain socket server that the `helm` CLI shim
 * uses to talk to the running HELM app. Protocol is newline-delimited
 * JSON: one request per line, one JSON response per connection.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
  /** Snapshot name if restored from a named snapshot */
  snapshotName?: string;
}

export interface TabInfo {
  id: string;
  label?: string;
  description?: string;
}

export interface HelmIPCServerHooks {
  /** Reserve a new tab id and stash pending context for it. Must return the tabId. */
  reserveTab: (ctx: PendingTabContext, label?: string) => string;
  /** Ask the renderer for the current tab list (round-trip; falls back to cache on timeout) */
  getTabs: () => Promise<TabInfo[]>;
  /** Bring the main HELM window to the front */
  focusWindow: () => void;
  /** Notify the renderer to create a tab with the given id and label */
  notifyRendererNewTab: (tabId: string, label: string) => void;
  /** Return version info — the running app's version and the shim version it ships */
  getVersionInfo: () => { appVersion: string; shimVersion: string };
}

const APP_SUPPORT = path.join(os.homedir(), 'Library', 'Application Support', 'Helm');
const SOCKET_PATH = path.join(APP_SUPPORT, 'helm.sock');

export class HelmIPCServer {
  private server: net.Server | null = null;
  private socketPath: string = SOCKET_PATH;

  constructor(private hooks: HelmIPCServerHooks) {}

  start(): void {
    // Ensure app-support dir exists
    if (!fs.existsSync(APP_SUPPORT)) {
      fs.mkdirSync(APP_SUPPORT, { recursive: true, mode: 0o700 });
    }

    // Remove a stale socket if present
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch {}
    }

    this.server = net.createServer((conn) => this.handleConnection(conn));
    this.server.on('error', (err) => {
      console.error('🔌 HELM IPC server error:', err);
    });

    this.server.listen(this.socketPath, () => {
      try { fs.chmodSync(this.socketPath, 0o600); } catch {}
      console.log(`🔌 HELM CLI socket listening at ${this.socketPath}`);
    });
  }

  stop(): void {
    if (this.server) {
      try { this.server.close(); } catch {}
      this.server = null;
    }
    if (fs.existsSync(this.socketPath)) {
      try { fs.unlinkSync(this.socketPath); } catch {}
    }
  }

  private handleConnection(conn: net.Socket): void {
    let buf = '';
    let dispatched = false; // guards handleRequest — only dispatch once per connection
    let replied = false;    // guards reply — only send one response

    const reply = (obj: any) => {
      if (replied) return;
      replied = true;
      try {
        conn.write(JSON.stringify(obj) + '\n');
      } catch {}
      conn.end();
    };

    conn.on('data', (chunk) => {
      if (dispatched) return; // already processing; ignore any further data
      buf += chunk.toString('utf-8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;

      dispatched = true;
      const line = buf.slice(0, nl);
      try {
        const req = JSON.parse(line);
        this.handleRequest(req).then(reply).catch((err) => {
          reply({ ok: false, error: err?.message || String(err) });
        });
      } catch (err: any) {
        reply({ ok: false, error: 'bad JSON: ' + (err?.message || String(err)) });
      }
    });

    conn.on('error', () => { /* client disconnected */ });

    // Timeout after 5s if nothing arrives
    setTimeout(() => {
      if (!replied) {
        reply({ ok: false, error: 'request timeout' });
      }
    }, 5000);
  }

  private async handleRequest(req: any): Promise<any> {
    switch (req.op) {
      case 'ping':
        return { ok: true, pong: true };

      case 'open-snapshot':
        return this.opOpenSnapshot(req.snapshotPath);

      case 'open-path':
        return this.opOpenPath(req.cwd);

      case 'run':
        return this.opRun(req.cwd, req.command);

      case 'list-tabs': {
        const tabs = await this.hooks.getTabs();
        return { ok: true, tabs };
      }

      case 'version': {
        const info = this.hooks.getVersionInfo();
        return { ok: true, ...info };
      }

      default:
        return { ok: false, error: `unknown op: ${req.op}` };
    }
  }

  private opOpenSnapshot(snapshotPath: string): any {
    if (!snapshotPath || !fs.existsSync(snapshotPath)) {
      return { ok: false, error: 'snapshot file not found' };
    }
    let snap: any;
    try {
      snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    } catch (err: any) {
      return { ok: false, error: 'invalid snapshot JSON: ' + err.message };
    }

    const ctx: PendingTabContext = {
      cwd: snap.cwd,
      env: snap.env || {},
      history: Array.isArray(snap.history) ? snap.history : [],
      source: 'snapshot',
      snapshotName: snap.name || undefined,
    };
    const label = snap.name ? `Snapshot: ${snap.name}` : this.labelFromCwd(snap.cwd);
    const tabId = this.hooks.reserveTab(ctx, label);
    this.hooks.notifyRendererNewTab(tabId, label);
    this.hooks.focusWindow();
    return { ok: true, tabId };
  }

  private opOpenPath(cwd: string): any {
    if (!cwd || !fs.existsSync(cwd)) {
      return { ok: false, error: 'path not found' };
    }
    const ctx: PendingTabContext = { cwd, source: 'open' };
    const label = this.labelFromCwd(cwd);
    const tabId = this.hooks.reserveTab(ctx, label);
    this.hooks.notifyRendererNewTab(tabId, label);
    this.hooks.focusWindow();
    return { ok: true, tabId };
  }

  private opRun(cwd: string, command: string): any {
    if (!command || !command.trim()) {
      return { ok: false, error: 'empty command' };
    }
    const ctx: PendingTabContext = {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      initialCommand: command,
      source: 'run',
    };
    // Label with first word of the command
    const firstWord = command.trim().split(/\s+/)[0];
    const label = `Run: ${firstWord}`;
    const tabId = this.hooks.reserveTab(ctx, label);
    this.hooks.notifyRendererNewTab(tabId, label);
    this.hooks.focusWindow();
    return { ok: true, tabId };
  }

  private labelFromCwd(cwd?: string): string {
    if (!cwd) return 'Terminal';
    const base = path.basename(cwd) || cwd;
    return base;
  }
}
