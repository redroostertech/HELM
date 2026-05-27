import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import type { CruiseOrchestrator } from '../cruise/orchestrator';
import type {
  AppMonitorSession,
  AppMonitorEvent,
  ForwardToCruiseArgs,
  DirectoryInspection,
  LaunchChildArgs,
} from './types';

interface AppMonitorServiceOptions {
  /**
   * Provider for the live cruise orchestrator. Lazy so we don't depend on
   * orchestrator construction order — main.ts constructs the orchestrator
   * after this service and the getter resolves at call time.
   */
  getCruiseOrchestrator: () => CruiseOrchestrator | null;
  /** Resolver for the renderer window — used to broadcast server-event + url-detected */
  getMainWindow: () => BrowserWindow | null;
}

/** Strip ANSI/VT100 escape codes so URL detection works on colorized output. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

/**
 * Match local dev-server URLs in stdout. Covers:
 *   - Hostnames: localhost, host.docker.internal
 *   - IPv4: 127.0.0.1, 0.0.0.0 (bind wildcard)
 *   - IPv6 in bracket form: [::1], [::], [fe80::...]
 * The browser can't connect to bind-wildcards (0.0.0.0 / [::]), so we
 * rewrite those to localhost when handing off to the webview — see
 * normalizeLocalUrl below.
 */
const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\[[0-9a-fA-F:]+\])(?::\d+)?(?:\/[^\s'"<>)\]]*)?)/i;

function normalizeLocalUrl(url: string): string {
  return url
    .replace(/^(https?:\/\/)0\.0\.0\.0/i, '$1localhost')
    .replace(/^(https?:\/\/)\[::\]/i, '$1localhost')
    .replace(/^(https?:\/\/)\[::1\]/i, '$1localhost');
}

/**
 * Read explicit URL targets from .cruise/targets.json. This is the
 * authoritative source for "what URLs does this project serve" when the
 * builder agents have populated it. Returns undefined if missing or
 * malformed (caller falls back to regex-based URL detection).
 */
function readTargetsFromDir(dir: string): import('./types').AppMonitorTarget[] | undefined {
  const p = path.join(dir, '.cruise', 'targets.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const raw = Array.isArray(parsed) ? parsed : parsed?.targets;
    if (!Array.isArray(raw)) return undefined;
    const out: import('./types').AppMonitorTarget[] = [];
    for (const t of raw) {
      if (!t || typeof t.name !== 'string' || typeof t.url !== 'string') continue;
      out.push({
        name: t.name,
        url: normalizeLocalUrl(t.url),
        primary: !!t.primary,
        description: typeof t.description === 'string' ? t.description : undefined,
      });
    }
    // Ensure at most one primary; default to first if none set.
    if (out.length > 0) {
      const hasPrimary = out.some(t => t.primary);
      if (!hasPrimary) out[0].primary = true;
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * AppMonitor service. v0 stores sessions in-memory only — persistence
 * (e.g. ~/Library/Application Support/Helm/app-monitor/sessions/) is a TODO.
 *
 * Events are captured renderer-side via <webview> DOM events; the main
 * process is responsible for IPC, the cruise-forward seam, and (later)
 * cross-launch persistence.
 */
export class AppMonitorService {
  private sessions: Map<string, AppMonitorSession> = new Map();
  /** Spawned dev-server processes, keyed by sessionId. */
  private children: Map<string, ChildProcess> = new Map();
  /** Sessions for which a URL was already auto-detected (avoid spamming). */
  private urlDetected: Set<string> = new Set();
  constructor(private opts: AppMonitorServiceOptions) {}

  listSessions(): AppMonitorSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  recordSession(session: AppMonitorSession): void {
    this.sessions.set(session.id, session);
  }

  appendEvent(sessionId: string, event: AppMonitorEvent): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.events.push(event);
    if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
  }

  endSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.endedAt = Date.now();
    // Tear down any associated child process so dev servers don't outlive
    // the session that started them.
    this.killChild(sessionId);
  }

  /** Permanently remove a session from the in-memory list. Kills the
   *  associated child process if still running. */
  deleteSession(sessionId: string): void {
    this.killChild(sessionId);
    this.sessions.delete(sessionId);
    this.urlDetected.delete(sessionId);
  }

  /**
   * Open a directory picker and return the chosen path (or null on cancel).
   */
  async pickDirectory(): Promise<string | null> {
    const win = this.opts.getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select project directory to launch & monitor',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  /**
   * Inspect a directory for launchable scripts/manifests. Detects:
   *   - package.json with scripts (Node projects — most common)
   *   - pyproject.toml or manage.py (Python)
   *   - bare index.html (static site)
   */
  async inspectDirectory(dir: string): Promise<DirectoryInspection> {
    if (!dir || !fs.existsSync(dir)) return { ok: false, error: `directory not found: ${dir}` };
    if (!fs.statSync(dir).isDirectory()) return { ok: false, error: `not a directory: ${dir}` };

    // Load explicit targets if present. The builder is expected to write this
    // as part of BUILD_COMPLETE so AppMonitor knows the canonical URLs for
    // every service the project exposes — not just the first one that prints.
    const targets = readTargetsFromDir(dir);

    // install.sh + run.sh are the canonical Cruise-generated launchers. When
    // either is present we promote them above npm scripts — the builder agents
    // know best how to start what they built.
    const installShPath = path.join(dir, 'install.sh');
    const runShPath = path.join(dir, 'run.sh');
    const hasInstall = fs.existsSync(installShPath);
    const hasRun = fs.existsSync(runShPath);
    if (hasInstall || hasRun) {
      const installExec = hasInstall && (fs.statSync(installShPath).mode & 0o111) !== 0;
      const runExec = hasRun && (fs.statSync(runShPath).mode & 0o111) !== 0;
      const installCmd = installExec ? './install.sh' : 'bash ./install.sh';
      const runCmd = runExec ? './run.sh' : 'bash ./run.sh';

      const scripts: Array<{ name: string; command: string }> = [];
      if (hasInstall && hasRun) {
        scripts.push({ name: 'install + run (first launch)', command: `${installCmd} && ${runCmd}` });
        scripts.push({ name: 'run only (re-launch)',         command: runCmd });
        scripts.push({ name: 'install only',                 command: installCmd });
      } else if (hasRun) {
        scripts.push({ name: 'run.sh',                       command: runCmd });
      } else {
        scripts.push({ name: 'install.sh',                   command: installCmd });
      }

      // Surface npm scripts as secondary suggestions if package.json exists.
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const scriptMap: Record<string, string> = pkg.scripts || {};
          for (const name of Object.keys(scriptMap)) {
            scripts.push({ name: `npm: ${name}`, command: `npm run ${name}` });
          }
        } catch { /* ignore — Cruise scripts are the primary path anyway */ }
      }

      const suggestions: string[] = [];
      if (hasInstall && !installExec) suggestions.push('chmod +x install.sh');
      if (hasRun && !runExec) suggestions.push('chmod +x run.sh');
      if (!hasInstall) suggestions.push('No install.sh — Cruise expects one. (run.sh alone is OK if deps are pre-installed.)');
      if (!hasRun) suggestions.push('No run.sh — Cruise builders should generate one before BUILD_COMPLETE.');
      return { ok: true, kind: 'node', scripts, suggestions, targets };
    }

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const scriptMap: Record<string, string> = pkg.scripts || {};
        const priority = ['dev', 'start', 'serve', 'preview', 'develop'];
        const ordered: Array<{ name: string; command: string }> = [];
        for (const name of priority) {
          if (scriptMap[name]) ordered.push({ name, command: `npm run ${name}` });
        }
        for (const [name, command] of Object.entries(scriptMap)) {
          if (priority.includes(name)) continue;
          ordered.push({ name, command: `npm run ${name}` });
        }
        return { ok: true, kind: 'node', scripts: ordered, suggestions: [], targets };
      } catch (e: unknown) {
        return { ok: false, error: 'failed to parse package.json: ' + (e instanceof Error ? e.message : String(e)) };
      }
    }

    if (fs.existsSync(path.join(dir, 'manage.py'))) {
      return { ok: true, kind: 'python', scripts: [], suggestions: ['python manage.py runserver'], targets };
    }
    if (fs.existsSync(path.join(dir, 'pyproject.toml'))) {
      return { ok: true, kind: 'python', scripts: [], suggestions: ['python -m http.server 8000', 'uvicorn main:app --reload'], targets };
    }
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return { ok: true, kind: 'static', scripts: [], suggestions: ['python3 -m http.server 8000', 'npx http-server -p 8000'], targets };
    }

    return { ok: true, kind: 'unknown', scripts: [], suggestions: [], targets };
  }

  /**
   * Spawn a child process for a directory-mode session. stdout/stderr lines
   * are emitted as `server`-kind events. The first localhost URL detected in
   * either stream triggers a `appMonitor:url-detected` broadcast so the
   * renderer can navigate the webview automatically.
   *
   * We spawn through a shell to allow scripts like `npm run dev` to work, and
   * mark detached: true + use `process.kill(-pid)` on cleanup so child trees
   * (npm → node → vite) all die when the session ends.
   */
  async launchChild(args: LaunchChildArgs): Promise<{ ok: boolean; pid?: number; error?: string }> {
    const { sessionId, cwd, command } = args;
    if (!sessionId || !cwd || !command) return { ok: false, error: 'sessionId, cwd and command are required' };
    if (this.children.has(sessionId)) return { ok: false, error: 'child already running for this session' };
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { ok: false, error: `cwd does not exist: ${cwd}` };

    const child = spawn(command, [], {
      cwd,
      shell: true,
      detached: true,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        // Python block-buffers stdout when stdio is a pipe (not a TTY),
        // so its startup banner never reaches us until the process exits.
        // PYTHONUNBUFFERED forces line-buffering and is a no-op for non-Python procs.
        PYTHONUNBUFFERED: '1',
      },
    });

    if (!child.pid) {
      return { ok: false, error: 'failed to spawn child process' };
    }

    this.children.set(sessionId, child);
    this.urlDetected.delete(sessionId);

    const emitServerLine = (line: string, severity: 'info' | 'warning' | 'error', stream: 'stdout' | 'stderr') => {
      const clean = stripAnsi(line);
      const win = this.opts.getMainWindow();
      const event: AppMonitorEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        kind: 'server',
        severity,
        message: clean.replace(/\s+$/, ''),
        meta: { stream },
      };
      this.appendEvent(sessionId, event);
      if (win && !win.isDestroyed()) {
        win.webContents.send('appMonitor:server-event', sessionId, event);
      }

      if (!this.urlDetected.has(sessionId)) {
        const m = clean.match(URL_RE);
        if (m) {
          const url = normalizeLocalUrl(m[1]);
          this.urlDetected.add(sessionId);
          if (win && !win.isDestroyed()) {
            win.webContents.send('appMonitor:url-detected', sessionId, url);
          }
        }
      }
    };

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl);
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line.trim()) emitServerLine(line, 'info', 'stdout');
      }
    });

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf-8');
      let nl: number;
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl);
        stderrBuf = stderrBuf.slice(nl + 1);
        // Many dev tools (Vite, Next) print their "Local: …" banner to stdout
        // and warnings/errors to stderr — but some print everything to stderr.
        // Default to warning for stderr but URL detection still runs.
        if (line.trim()) emitServerLine(line, 'warning', 'stderr');
      }
    });

    child.on('exit', (code, signal) => {
      const win = this.opts.getMainWindow();
      const sev = code === 0 || code === null ? 'info' : 'error';
      const msg = `Child process exited (code=${code ?? signal})`;
      const event: AppMonitorEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        kind: 'server',
        severity: sev,
        message: msg,
        meta: { exitCode: code, signal },
      };
      this.appendEvent(sessionId, event);
      if (win && !win.isDestroyed()) {
        win.webContents.send('appMonitor:server-event', sessionId, event);
      }
      this.children.delete(sessionId);
    });

    return { ok: true, pid: child.pid };
  }

  /** Kill the child process associated with a session (and its descendants). */
  killChild(sessionId: string): { ok: boolean; error?: string } {
    const child = this.children.get(sessionId);
    if (!child) return { ok: true };
    try {
      // Negative PID with shell+detached kills the whole process group.
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch {}
    }
    // Hard-kill after a grace period if the process is stubborn.
    setTimeout(() => {
      if (!this.children.has(sessionId)) return;
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    }, 3000);
    this.children.delete(sessionId);
    return { ok: true };
  }

  /** Cleanup hook for app quit — kill every child we spawned. */
  killAllChildren(): void {
    for (const sessionId of Array.from(this.children.keys())) this.killChild(sessionId);
  }

  /**
   * Forward an AppMonitor finding into a Cruise run as a TASK-FOR-style
   * task. For v0 this is a thin seam: the orchestrator's persistAndRouteTask
   * is currently private, so we log + return a structured warning so the
   * renderer can show "queued (stub)" feedback. When the orchestrator
   * exposes a public hook for external task injection, wire it here.
   *
   * TODO(app-monitor): orchestrator.persistAndRouteTask is private — extend
   * CruiseOrchestrator with a public injectExternalTask(runId, role, summary,
   * severity) method that maps to the same code path. Until then this is a
   * no-op-warning path and findings are only visible in the AppMonitor feed.
   */
  async forwardToCruise(args: ForwardToCruiseArgs): Promise<{ ok: boolean; error?: string }> {
    const orch = this.opts.getCruiseOrchestrator();
    if (!orch) {
      return { ok: false, error: 'cruise orchestrator not available' };
    }
    const anyOrch = orch as unknown as {
      injectExternalTask?: (
        runId: number,
        role: string,
        summary: string,
        severity: string,
      ) => Promise<void>;
    };
    if (typeof anyOrch.injectExternalTask === 'function') {
      try {
        await anyOrch.injectExternalTask(args.runId, args.role, args.summary, args.severity);
        return { ok: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
      }
    }
    console.warn(
      `[AppMonitor] forwardToCruise stub: run=${args.runId} role=${args.role} ` +
      `severity=${args.severity} summary="${args.summary.slice(0, 120)}"`,
    );
    return { ok: false, error: 'cruise integration not yet wired (v0 stub)' };
  }
}

export function registerAppMonitorIPC(service: AppMonitorService): void {
  ipcMain.handle('appMonitor:listSessions', () => service.listSessions());

  ipcMain.handle('appMonitor:recordSession', (_e, session: AppMonitorSession) => {
    service.recordSession(session);
    return { ok: true };
  });

  ipcMain.handle('appMonitor:appendEvent', (_e, sessionId: string, event: AppMonitorEvent) => {
    service.appendEvent(sessionId, event);
    return { ok: true };
  });

  ipcMain.handle('appMonitor:endSession', (_e, sessionId: string) => {
    service.endSession(sessionId);
    return { ok: true };
  });

  ipcMain.handle('appMonitor:forwardToCruise', (_e, args: ForwardToCruiseArgs) => {
    return service.forwardToCruise(args);
  });

  ipcMain.handle('appMonitor:pickDirectory', () => service.pickDirectory());

  ipcMain.handle('appMonitor:inspectDirectory', (_e, dir: string) => service.inspectDirectory(dir));

  ipcMain.handle('appMonitor:launchChild', (_e, args: LaunchChildArgs) => service.launchChild(args));

  ipcMain.handle('appMonitor:killChild', (_e, sessionId: string) => service.killChild(sessionId));

  ipcMain.handle('appMonitor:deleteSession', (_e, sessionId: string) => {
    service.deleteSession(sessionId);
    return { ok: true };
  });
}
