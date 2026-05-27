export type AppMonitorEventKind =
  | 'console'
  | 'error'
  | 'navigation'
  | 'load'
  | 'crash'
  | 'network';

export type AppMonitorSeverity = 'verbose' | 'info' | 'warning' | 'error';

export interface AppMonitorEvent {
  id: string;
  ts: number;
  kind: AppMonitorEventKind;
  severity: AppMonitorSeverity;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AppMonitorSession {
  id: string;
  url: string;
  startedAt: number;
  endedAt: number | null;
  events: AppMonitorEvent[];
}

export interface ForwardToCruiseArgs {
  runId: number;
  role: string;
  summary: string;
  severity: AppMonitorSeverity | 'critical';
}
