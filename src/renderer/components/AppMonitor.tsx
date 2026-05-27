import { useState, useEffect, useRef, useCallback } from 'react';
import './AppMonitor.css';

type EventKind = 'console' | 'error' | 'navigation' | 'load' | 'crash' | 'network';
type Severity = 'verbose' | 'info' | 'warning' | 'error';

interface AppMonitorEvent {
  id: string;
  ts: number;
  kind: EventKind;
  severity: Severity;
  message: string;
  meta?: Record<string, unknown>;
}

interface AppMonitorSession {
  id: string;
  url: string;
  startedAt: number;
  endedAt: number | null;
  events: AppMonitorEvent[];
}

interface AppMonitorProps {
  theme: 'dark' | 'light';
}

const VIEWPORT_PRESETS = [
  { label: 'Desktop (1280×800)', width: 1280, height: 800 },
  { label: 'Laptop (1024×768)',  width: 1024, height: 768 },
  { label: 'Tablet (768×1024)',  width: 768,  height: 1024 },
  { label: 'Mobile (375×667)',   width: 375,  height: 667 },
];

const SEVERITY_COLOR: Record<Severity, string> = {
  verbose: '#888',
  info:    '#4a9eff',
  warning: '#f5a623',
  error:   '#e85a4f',
};

const EVENT_CAP = 500;

function newSessionId(): string {
  return `am-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function levelToSeverity(level: number): Severity {
  switch (level) {
    case 0: return 'verbose';
    case 1: return 'info';
    case 2: return 'warning';
    case 3: return 'error';
    default: return 'info';
  }
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export default function AppMonitor({ theme }: AppMonitorProps) {
  const [sessions, setSessions] = useState<AppMonitorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('https://example.com');
  const [viewport, setViewport] = useState(VIEWPORT_PRESETS[0]);
  const [cruiseRuns, setCruiseRuns] = useState<Array<{ id: number; target_repo: string; status: string }>>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runRoles, setRunRoles] = useState<string[]>([]);
  const [forwardingEvent, setForwardingEvent] = useState<AppMonitorEvent | null>(null);
  const [forwardSummary, setForwardSummary] = useState('');
  const [forwardRole, setForwardRole] = useState<string>('');
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardResult, setForwardResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const webviewRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;

  // Load past sessions on mount
  useEffect(() => {
    if (!window.electronAPI.appMonitor) return;
    window.electronAPI.appMonitor.listSessions()
      .then(list => setSessions(list || []))
      .catch(() => {});
  }, []);

  // Load cruise runs (silent fail — cruise may not be available)
  const loadCruiseRuns = useCallback(async () => {
    try {
      if (!window.electronAPI.cruise) return;
      const list = await window.electronAPI.cruise.listRuns();
      setCruiseRuns(list || []);
    } catch {
      setCruiseRuns([]);
    }
  }, []);

  useEffect(() => { loadCruiseRuns(); }, [loadCruiseRuns]);

  // When user picks a run, fetch agent roles
  useEffect(() => {
    if (!selectedRunId || !window.electronAPI.cruise) { setRunRoles([]); return; }
    window.electronAPI.cruise.getRun(selectedRunId)
      .then(details => {
        if (!details) { setRunRoles([]); return; }
        const roles = Array.from(new Set((details.agents || []).map((a: any) => a.role).filter(Boolean)));
        setRunRoles(roles as string[]);
      })
      .catch(() => setRunRoles([]));
  }, [selectedRunId]);

  // Auto-scroll event feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activeSession?.events.length]);

  const appendEvent = useCallback((sessionId: string, event: AppMonitorEvent) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const nextEvents = [...s.events, event];
      if (nextEvents.length > EVENT_CAP) nextEvents.splice(0, nextEvents.length - EVENT_CAP);
      return { ...s, events: nextEvents };
    }));
    window.electronAPI.appMonitor?.appendEvent(sessionId, event).catch(() => {});
  }, []);

  // Attach webview event listeners whenever the active session changes
  useEffect(() => {
    if (!activeSession || !webviewRef.current) return;
    const wv = webviewRef.current as any;
    const sessionId = activeSession.id;

    const onConsole = (e: any) => {
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'console',
        severity: levelToSeverity(e.level),
        message: String(e.message ?? ''),
        meta: { line: e.line, sourceId: e.sourceId },
      });
    };
    const onDidFailLoad = (e: any) => {
      // Ignore the spurious -3 (ABORTED) that fires on every did-navigate
      if (e.errorCode === -3) return;
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'error',
        severity: 'error',
        message: `Load failed: ${e.errorDescription} (${e.errorCode}) ${e.validatedURL || ''}`.trim(),
        meta: { errorCode: e.errorCode, url: e.validatedURL },
      });
    };
    const onDidFinishLoad = () => {
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'load',
        severity: 'info',
        message: `Loaded ${wv.getURL?.() || ''}`,
      });
    };
    const onDidNavigate = (e: any) => {
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'navigation',
        severity: 'info',
        message: `Navigated to ${e.url}`,
        meta: { url: e.url },
      });
    };
    const onCrashed = () => {
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'crash',
        severity: 'error',
        message: 'Renderer process crashed',
      });
    };
    const onUnresponsive = () => {
      appendEvent(sessionId, {
        id: newEventId(),
        ts: Date.now(),
        kind: 'error',
        severity: 'warning',
        message: 'Page became unresponsive',
      });
    };

    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('did-fail-load', onDidFailLoad);
    wv.addEventListener('did-finish-load', onDidFinishLoad);
    wv.addEventListener('did-navigate', onDidNavigate);
    wv.addEventListener('did-navigate-in-page', onDidNavigate);
    wv.addEventListener('crashed', onCrashed);
    wv.addEventListener('unresponsive', onUnresponsive);

    return () => {
      try { wv.removeEventListener('console-message', onConsole); } catch {}
      try { wv.removeEventListener('did-fail-load', onDidFailLoad); } catch {}
      try { wv.removeEventListener('did-finish-load', onDidFinishLoad); } catch {}
      try { wv.removeEventListener('did-navigate', onDidNavigate); } catch {}
      try { wv.removeEventListener('did-navigate-in-page', onDidNavigate); } catch {}
      try { wv.removeEventListener('crashed', onCrashed); } catch {}
      try { wv.removeEventListener('unresponsive', onUnresponsive); } catch {}
    };
  }, [activeSession?.id, appendEvent]);

  const handleLaunch = () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const session: AppMonitorSession = {
      id: newSessionId(),
      url,
      startedAt: Date.now(),
      endedAt: null,
      events: [{
        id: newEventId(),
        ts: Date.now(),
        kind: 'navigation',
        severity: 'info',
        message: `Session started → ${url}`,
      }],
    };
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
    window.electronAPI.appMonitor?.recordSession(session).catch(() => {});
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
  };

  const handleStopSession = (id: string) => {
    setSessions(prev => prev.map(s => s.id === id && !s.endedAt ? { ...s, endedAt: Date.now() } : s));
    window.electronAPI.appMonitor?.endSession(id).catch(() => {});
  };

  const openForward = (evt: AppMonitorEvent) => {
    setForwardingEvent(evt);
    setForwardSummary(evt.message);
    setForwardRole(runRoles[0] || 'builder');
    setForwardResult(null);
  };

  const submitForward = async () => {
    if (!forwardingEvent || !selectedRunId || !forwardRole) return;
    setForwardBusy(true);
    try {
      const res = await window.electronAPI.appMonitor.forwardToCruise({
        runId: selectedRunId,
        role: forwardRole,
        summary: forwardSummary,
        severity: forwardingEvent.severity,
      });
      setForwardResult({ ok: res.ok, msg: res.ok ? 'Forwarded' : (res.error || 'Failed') });
      if (res.ok) {
        setTimeout(() => { setForwardingEvent(null); setForwardResult(null); }, 1200);
      }
    } catch (e: any) {
      setForwardResult({ ok: false, msg: e?.message || 'Failed' });
    } finally {
      setForwardBusy(false);
    }
  };

  return (
    <div className="app-monitor" data-theme={theme}>
      {/* Sidebar: past sessions */}
      <aside className="am-sidebar">
        <div className="am-sidebar-header">
          <h2>Sessions</h2>
        </div>
        <div className="am-session-list">
          {sessions.length === 0 && (
            <div className="am-empty">No sessions yet. Launch a URL to start.</div>
          )}
          {sessions.map(s => (
            <div
              key={s.id}
              className={`am-session-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => handleSelectSession(s.id)}
            >
              <div className="am-session-url" title={s.url}>{s.url}</div>
              <div className="am-session-meta">
                <span>{new Date(s.startedAt).toLocaleTimeString()}</span>
                <span className={s.endedAt ? 'ended' : 'live'}>
                  {s.endedAt ? 'ended' : 'live'}
                </span>
                <span>{s.events.length} ev</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main area */}
      <main className="am-main">
        {/* Launch form */}
        <div className="am-launch">
          <input
            className="am-url-input"
            type="text"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="https://example.com"
            onKeyDown={e => { if (e.key === 'Enter') handleLaunch(); }}
          />
          <select
            className="am-viewport-select"
            value={viewport.label}
            onChange={e => {
              const v = VIEWPORT_PRESETS.find(p => p.label === e.target.value);
              if (v) setViewport(v);
            }}
          >
            {VIEWPORT_PRESETS.map(v => (
              <option key={v.label} value={v.label}>{v.label}</option>
            ))}
          </select>
          <button className="am-launch-btn" onClick={handleLaunch}>Launch</button>
          {activeSession && !activeSession.endedAt && (
            <button className="am-stop-btn" onClick={() => handleStopSession(activeSession.id)}>
              Stop
            </button>
          )}
        </div>

        {/* Webview + feed split */}
        <div className="am-split">
          <div className="am-viewport-wrap">
            {activeSession ? (
              <webview
                key={activeSession.id}
                ref={(el) => { webviewRef.current = el as unknown as HTMLElement; }}
                src={activeSession.url}
                style={{
                  width: `${viewport.width}px`,
                  height: `${viewport.height}px`,
                  maxWidth: '100%',
                  maxHeight: '100%',
                  background: '#fff',
                }}
                // @ts-expect-error — webview is an Electron-only element, not in React's JSX.IntrinsicElements
                allowpopups="true"
              />
            ) : (
              <div className="am-viewport-placeholder">
                Enter a URL above and click Launch to embed a target app here.
              </div>
            )}
          </div>

          <div className="am-feed">
            <div className="am-feed-header">
              <span className="am-feed-title">Events</span>
              <select
                className="am-run-select"
                value={selectedRunId ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setSelectedRunId(v ? Number(v) : null);
                }}
              >
                <option value="">Forward findings to: (none)</option>
                {cruiseRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    Run #{r.id} · {r.target_repo.split('/').pop() || r.target_repo} · {r.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="am-feed-body" ref={feedRef}>
              {(!activeSession || activeSession.events.length === 0) && (
                <div className="am-empty">No events yet.</div>
              )}
              {activeSession?.events.map(evt => (
                <div key={evt.id} className={`am-event sev-${evt.severity}`}>
                  <span className="am-event-ts">{formatTs(evt.ts)}</span>
                  <span
                    className="am-event-sev"
                    style={{ color: SEVERITY_COLOR[evt.severity] }}
                  >
                    {evt.severity.toUpperCase()}
                  </span>
                  <span className="am-event-kind">{evt.kind}</span>
                  <span className="am-event-msg">{evt.message}</span>
                  {(evt.severity === 'warning' || evt.severity === 'error') && (
                    <button
                      className="am-event-fwd"
                      title={selectedRunId ? 'Forward to cruise' : 'Pick a cruise run first (top dropdown)'}
                      onClick={() => openForward(evt)}
                      disabled={!selectedRunId && runRoles.length === 0}
                    >
                      → Cruise
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Forward modal */}
        {forwardingEvent && (
          <div className="am-modal-backdrop" onClick={() => setForwardingEvent(null)}>
            <div className="am-modal" onClick={e => e.stopPropagation()}>
              <h3>Forward to Cruise</h3>
              <div className="am-modal-row">
                <label>Run</label>
                <div className="am-modal-static">
                  {selectedRunId ? `#${selectedRunId}` : '(none selected)'}
                </div>
              </div>
              <div className="am-modal-row">
                <label>Role</label>
                <select value={forwardRole} onChange={e => setForwardRole(e.target.value)}>
                  {(runRoles.length ? runRoles : ['builder', 'reviewer', 'prd-refiner']).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="am-modal-row">
                <label>Severity</label>
                <div className="am-modal-static">{forwardingEvent.severity}</div>
              </div>
              <div className="am-modal-row am-modal-row-summary">
                <label>Summary</label>
                <textarea
                  value={forwardSummary}
                  onChange={e => setForwardSummary(e.target.value)}
                  rows={5}
                />
              </div>
              {forwardResult && (
                <div className={`am-modal-result ${forwardResult.ok ? 'ok' : 'err'}`}>
                  {forwardResult.msg}
                </div>
              )}
              <div className="am-modal-actions">
                <button onClick={() => setForwardingEvent(null)}>Cancel</button>
                <button
                  className="am-primary"
                  onClick={submitForward}
                  disabled={forwardBusy || !selectedRunId || !forwardSummary.trim()}
                >
                  {forwardBusy ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
