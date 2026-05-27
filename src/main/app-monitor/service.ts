import { ipcMain } from 'electron';
import type { CruiseOrchestrator } from '../cruise/orchestrator';
import type {
  AppMonitorSession,
  AppMonitorEvent,
  ForwardToCruiseArgs,
} from './types';

interface AppMonitorServiceOptions {
  /**
   * Provider for the live cruise orchestrator. Lazy so we don't depend on
   * orchestrator construction order — main.ts constructs the orchestrator
   * after this service and the getter resolves at call time.
   */
  getCruiseOrchestrator: () => CruiseOrchestrator | null;
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
    // Cap at 500 to keep memory bounded (matches renderer cap).
    if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
  }

  endSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.endedAt = Date.now();
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
}
