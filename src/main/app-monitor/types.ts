export type AppMonitorEventKind =
  | 'console'
  | 'error'
  | 'navigation'
  | 'load'
  | 'crash'
  | 'network'
  | 'server';        // stdout/stderr from a child process launched by Directory mode

export type AppMonitorSeverity = 'verbose' | 'info' | 'warning' | 'error';

export type AppMonitorTargetKind = 'url' | 'directory';

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
  /** Optional directory context for directory-mode sessions */
  cwd?: string;
  command?: string;
}

export interface ForwardToCruiseArgs {
  runId: number;
  role: string;
  summary: string;
  severity: AppMonitorSeverity | 'critical';
}

export interface AppMonitorTarget {
  name: string;
  url: string;
  primary?: boolean;
  description?: string;
}

export interface DirectoryInspection {
  ok: boolean;
  error?: string;
  /** Detected project kind, used for ordering / hinting */
  kind?: 'node' | 'python' | 'static' | 'unknown';
  /** npm scripts when package.json exists, ordered with likely candidates first */
  scripts?: Array<{ name: string; command: string }>;
  /** Suggested fallback commands (host + port hints) */
  suggestions?: string[];
  /** Explicit URL targets from .cruise/targets.json (authoritative when present) */
  targets?: AppMonitorTarget[];
}

export interface LaunchChildArgs {
  sessionId: string;
  cwd: string;
  command: string;
}
