import { useState, useEffect, useRef, useCallback } from 'react';
import TerminalPane from './TerminalPane';
import ConfirmModal from './ConfirmModal';
import './CruisePanel.css';

interface CruiseRun {
  id: number;
  target_repo: string;
  status: string;
  current_phase: string;
  review_cycle: number;
  config: any;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
}

interface CruiseAgent {
  id: number;
  run_id: number;
  role: string;
  program_id: string;
  tab_id: string | null;
  cli_session_id: number | null;
  status: string;
  label: string | null;
  started_at: string;
  ended_at: string | null;
}

interface CruiseEvent {
  id: number;
  run_id: number;
  agent_id: number | null;
  type: string;
  phase: string;
  payload: any;
  ts: string;
}

interface CruisePanelProps {
  theme: 'dark' | 'light';
  /** Reports which tab IDs are owned by Cruise (so App can dim them in TabBar) */
  onCruiseTabsChange?: (tabIds: string[]) => void;
  /** Reports tab-IDs needing attention so TabBar can pulse them */
  onAttentionChange?: (attention: Record<string, string | null>) => void;
}

const PHASES = [
  { key: 'prd-refine',      label: 'Refine PRD' },
  { key: 'prd-approve',     label: 'Approve PRD' },
  { key: 'plan-refine',     label: 'Plan Team' },
  { key: 'build',           label: 'Build' },
  { key: 'review',          label: 'Review' },
  { key: 'done',            label: 'Done' },
];

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  pending:      { color: '#666',     label: 'Pending' },
  spawning:     { color: '#888',     label: 'Spawning…' },
  active:       { color: '#3ab36e',  label: 'Active' },
  idle:         { color: '#9aa',     label: 'Idle' },
  'needs-input':{ color: '#f5a623',  label: 'Needs input' },
  completed:    { color: '#4a9eff',  label: 'Completed' },
  killed:       { color: '#888',     label: 'Killed' },
  failed:       { color: '#e85a4f',  label: 'Failed' },
};

export default function CruisePanel({ theme, onCruiseTabsChange, onAttentionChange }: CruisePanelProps) {
  const [runs, setRuns] = useState<CruiseRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [runDetails, setRunDetails] = useState<{ run: CruiseRun; agents: CruiseAgent[]; events: CruiseEvent[]; artifacts: { runDirExists: boolean; files: string[] } } | null>(null);
  const [showStart, setShowStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prdDraftPreview, setPrdDraftPreview] = useState('');
  const [focusedAgentTabId, setFocusedAgentTabId] = useState<string | null>(null);
  const [attentionByTab, setAttentionByTab] = useState<Record<string, string | null>>({});
  const [confirmStop, setConfirmStop] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const eventsTailRef = useRef<HTMLDivElement>(null);

  // Initial load
  const loadRuns = useCallback(async () => {
    try {
      const list = await window.electronAPI.cruise.listRuns();
      setRuns(list || []);
      // If there's an active run and we don't have one selected, auto-focus the most recent active
      if (!activeRunId) {
        const active = (list || []).find((r: CruiseRun) => r.status === 'running' || r.status === 'paused');
        if (active) setActiveRunId(active.id);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load runs');
    }
  }, [activeRunId]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // Load full details for the active run
  const refreshActiveRun = useCallback(async () => {
    if (!activeRunId) { setRunDetails(null); return; }
    try {
      const details = await window.electronAPI.cruise.getRun(activeRunId);
      if (details) {
        setRunDetails(details);
        const tabIds = details.agents.map(a => a.tab_id).filter((x): x is string => !!x);
        onCruiseTabsChange?.(tabIds);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load run details');
    }
  }, [activeRunId, onCruiseTabsChange]);

  useEffect(() => { refreshActiveRun(); }, [refreshActiveRun]);

  // Auto-focus a lead agent whenever the phase changes (or when the
  // currently-focused tab no longer exists / hasn't been spawned yet).
  // With multi-agent phases (multiple builders / reviewers), focus the
  // first spawned lead — the user can click any other card to switch.
  useEffect(() => {
    if (!runDetails) return;
    const isLead = leadRoleMatcher(runDetails.run.current_phase);
    const leads = runDetails.agents.filter(a => isLead(a.role) && a.tab_id);
    const fallback = runDetails.agents.find(a => a.tab_id);
    const focusedStillValid = runDetails.agents.some(a => a.tab_id === focusedAgentTabId);
    const focusedIsLead = !!focusedAgentTabId && leads.some(l => l.tab_id === focusedAgentTabId);

    if (!focusedAgentTabId || !focusedStillValid) {
      const target = leads[0] || fallback;
      if (target?.tab_id) setFocusedAgentTabId(target.tab_id);
      return;
    }
    if (leads.length > 0 && !focusedIsLead) {
      // Phase advanced; current focus is on a non-lead — shift to a lead.
      if (leads[0].tab_id) setFocusedAgentTabId(leads[0].tab_id);
    }
  }, [runDetails?.run.current_phase, runDetails?.agents.length, focusedAgentTabId]);

  // Wire live event listeners
  useEffect(() => {
    const cleanupEvent = window.electronAPI.cruise.onEvent((evt) => {
      if (!activeRunId || evt.runId !== activeRunId) return;
      setRunDetails(prev => prev ? { ...prev, events: [...prev.events, evt] } : prev);
      // Some events imply we should refresh agent state from DB
      if (['agent.spawned', 'agent.ready', 'agent.killed', 'phase.entered'].includes(evt.type)) {
        refreshActiveRun();
      }
    });
    const cleanupPhase = window.electronAPI.cruise.onPhaseChanged((sig) => {
      if (sig.runId === activeRunId) refreshActiveRun();
    });
    const cleanupStarted = window.electronAPI.cruise.onRunStarted(({ runId }) => {
      setActiveRunId(runId);
      loadRuns();
    });
    const cleanupFinished = window.electronAPI.cruise.onRunFinished(({ runId }) => {
      if (runId === activeRunId) refreshActiveRun();
      loadRuns();
    });
    const cleanupAttention = window.electronAPI.cruise.onAttention((sig) => {
      setAttentionByTab(prev => {
        const next = { ...prev, [sig.tabId]: sig.reason };
        onAttentionChange?.(next);
        return next;
      });
    });
    const cleanupAttentionClear = window.electronAPI.cruise.onAttentionCleared((sig) => {
      setAttentionByTab(prev => {
        const next = { ...prev };
        delete next[sig.tabId];
        onAttentionChange?.(next);
        return next;
      });
    });
    return () => {
      cleanupEvent();
      cleanupPhase();
      cleanupStarted();
      cleanupFinished();
      cleanupAttention();
      cleanupAttentionClear();
    };
  }, [activeRunId, loadRuns, refreshActiveRun, onAttentionChange]);

  // Auto-scroll audit log
  useEffect(() => {
    if (eventsTailRef.current) {
      eventsTailRef.current.scrollTop = eventsTailRef.current.scrollHeight;
    }
  }, [runDetails?.events.length]);

  // When a different agent terminal becomes focused, the embedded TerminalPane
  // mounts into a container with different dimensions than the agent's original
  // spawn-time width. Dispatch a window-resize so xterm refits AND the PTY is
  // re-sized to match (TerminalPane's resize handler does both).
  useEffect(() => {
    if (!focusedAgentTabId) return;
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [focusedAgentTabId]);

  // When the run enters prd-approve, fetch the draft for preview
  useEffect(() => {
    if (runDetails?.run.current_phase === 'prd-approve' && activeRunId) {
      // Read prd-draft.md by re-fetching getRun (artifacts.files will contain it)
      // For the preview, ask the user to inspect the file in their editor — we
      // could also expose a dedicated readPrdDraft IPC; for now, leave preview empty.
      setPrdDraftPreview('');
    }
  }, [runDetails?.run.current_phase, activeRunId]);

  const handleStart = async (repo: string, opts: { autoApprovePRD: boolean; maxReviewCycles: number }) => {
    setBusy(true);
    setError(null);
    try {
      const { runId } = await window.electronAPI.cruise.start({
        targetRepo: repo,
        autoApprovePRD: opts.autoApprovePRD,
        maxReviewCycles: opts.maxReviewCycles,
      });
      setActiveRunId(runId);
      setShowStart(false);
      await loadRuns();
    } catch (err: any) {
      setError(err?.message || 'Failed to start run');
    } finally {
      setBusy(false);
    }
  };

  const handlePause = async () => {
    if (!activeRunId) return;
    setBusy(true);
    try { await window.electronAPI.cruise.pause(activeRunId); await refreshActiveRun(); }
    catch (err: any) { setError(err?.message || 'pause failed'); }
    finally { setBusy(false); }
  };

  const handleResume = async () => {
    if (!activeRunId) return;
    setBusy(true);
    try { await window.electronAPI.cruise.resume(activeRunId); await refreshActiveRun(); }
    catch (err: any) { setError(err?.message || 'resume failed'); }
    finally { setBusy(false); }
  };

  const handleStop = () => {
    if (!activeRunId) return;
    setConfirmStop(activeRunId);
  };

  const performStop = async () => {
    const runId = confirmStop;
    setConfirmStop(null);
    if (!runId) return;
    setBusy(true);
    try { await window.electronAPI.cruise.stop(runId); await loadRuns(); await refreshActiveRun(); }
    catch (err: any) { setError(err?.message || 'stop failed'); }
    finally { setBusy(false); }
  };

  const handleApprovePRD = async () => {
    if (!activeRunId) return;
    setBusy(true);
    try {
      // For v1 we approve the draft as-is. The full editor flow can come later.
      await window.electronAPI.cruise.approvePRD(activeRunId, prdDraftPreview || undefined);
      await refreshActiveRun();
    } catch (err: any) {
      setError(err?.message || 'approve failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (runId: number) => {
    setConfirmDelete(runId);
  };

  const performDelete = async () => {
    const runId = confirmDelete;
    setConfirmDelete(null);
    if (!runId) return;
    try {
      await window.electronAPI.cruise.delete(runId);
      if (activeRunId === runId) setActiveRunId(null);
      await loadRuns();
    } catch (err: any) { setError(err?.message || 'delete failed'); }
  };

  return (
    <div className="cruise-panel" data-theme={theme}>
      <div className="cruise-sidebar">
        <div className="cruise-sidebar-header">
          <h2>Cruise Control</h2>
          <button className="cruise-new-btn" onClick={() => setShowStart(true)}>+ New Run</button>
        </div>
        <div className="cruise-run-list">
          {runs.length === 0 && (
            <div className="cruise-empty">No runs yet. Click <strong>+ New Run</strong> to start.</div>
          )}
          {runs.map(r => (
            <div
              key={r.id}
              className={`cruise-run-item ${activeRunId === r.id ? 'active' : ''} status-${r.status}`}
              onClick={() => setActiveRunId(r.id)}
            >
              <div className="cruise-run-title">#{r.id} · {basename(r.target_repo)}</div>
              <div className="cruise-run-meta">
                <span className={`cruise-status-pill status-${r.status}`}>{r.status}</span>
                <span>{r.current_phase}</span>
              </div>
              <button
                className="cruise-run-delete"
                onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                title="Delete run"
              >×</button>
            </div>
          ))}
        </div>
      </div>

      <div className="cruise-main">
        {error && (
          <div className="cruise-error">
            {error}
            <button onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        {!runDetails && !showStart && (
          <div className="cruise-welcome">
            <h1>Cruise Control</h1>
            <p>Multi-agent orchestration: Claude refines your PRD, Codex builds it, Claude reviews. You approve at the gates.</p>
            <button className="cruise-primary" onClick={() => setShowStart(true)}>Start a new run</button>
          </div>
        )}

        {runDetails && (
          <>
            <CruiseRunHeader
              run={runDetails.run}
              onPause={handlePause}
              onResume={handleResume}
              onStop={handleStop}
              busy={busy}
            />
            <PhaseTimeline phase={runDetails.run.current_phase} status={runDetails.run.status} reviewCycle={runDetails.run.review_cycle} />
            <div className="cruise-agents">
              {runDetails.agents.map(ag => (
                <AgentCard
                  key={ag.id}
                  agent={ag}
                  attentionReason={ag.tab_id ? attentionByTab[ag.tab_id] : null}
                  focused={!!ag.tab_id && ag.tab_id === focusedAgentTabId}
                  onFocus={() => ag.tab_id && setFocusedAgentTabId(ag.tab_id)}
                  messageStats={computeMessageStats(ag.role, runDetails.events)}
                  taskStats={computeTaskStats(ag.role, runDetails.events)}
                />
              ))}
            </div>

            {runDetails.run.current_phase === 'prd-approve' && (
              <div className="cruise-approval-gate">
                <h3>PRD Refined — your approval required</h3>
                <p>The PRD-refiner has written a refined draft to <code>.cruise/runs/{runDetails.run.id}/prd-draft.md</code>. Review it in your editor, then click Approve to start the build. You may paste an edited version here to override the draft.</p>
                <textarea
                  className="cruise-prd-editor"
                  placeholder="Paste edited PRD here, or leave blank to approve the draft as-is."
                  value={prdDraftPreview}
                  onChange={(e) => setPrdDraftPreview(e.target.value)}
                  rows={10}
                />
                <div className="cruise-approval-actions">
                  <button className="cruise-primary" onClick={handleApprovePRD} disabled={busy}>Approve & start build</button>
                </div>
              </div>
            )}

            <div className="cruise-terminal-area">
              {/* Mount one TerminalPane per spawned agent and toggle visibility,
                  so switching focus preserves xterm scrollback. Remounting on
                  focus change would otherwise discard the buffer. */}
              {runDetails.agents.filter(a => !!a.tab_id).map(a => (
                <TerminalPane
                  key={a.tab_id!}
                  tabId={a.tab_id!}
                  theme={theme}
                  isVisible={a.tab_id === focusedAgentTabId}
                  onAskClaude={() => {}}
                />
              ))}
              {!focusedAgentTabId && (
                <div className="cruise-no-terminal">Waiting for an agent to spawn…</div>
              )}
            </div>

            <div className="cruise-audit">
              <div className="cruise-audit-header">Audit log ({runDetails.events.length})</div>
              <div className="cruise-audit-list" ref={eventsTailRef}>
                {runDetails.events.map(ev => (
                  <div key={ev.id} className={`cruise-audit-item evt-${ev.type.split('.')[0]}`}>
                    <span className="cruise-audit-ts">{formatTime(ev.ts)}</span>
                    <span className="cruise-audit-type">{ev.type}</span>
                    <span className="cruise-audit-phase">{ev.phase}</span>
                    {ev.payload && <span className="cruise-audit-payload">{previewPayload(ev.payload)}</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {showStart && (
          <StartDialog
            onCancel={() => setShowStart(false)}
            onStart={handleStart}
            busy={busy}
          />
        )}

        <ConfirmModal
          isOpen={confirmStop !== null}
          title="Stop this run?"
          message="Agent CLIs will be killed and a checkpoint will be saved. You can resume the run later from its checkpoint."
          confirmLabel="Stop run"
          danger
          onConfirm={performStop}
          onCancel={() => setConfirmStop(null)}
        />

        <ConfirmModal
          isOpen={confirmDelete !== null}
          title="Delete this run?"
          message="This permanently removes the run, its agents, and its audit log. Artifacts under .cruise/ in the repo are kept."
          confirmLabel="Delete run"
          danger
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function CruiseRunHeader({ run, onPause, onResume, onStop, busy }: {
  run: CruiseRun;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  // Resume-from-checkpoint is only meaningful for runs that were halted
  // mid-flight (stopped) or errored (failed). A `done` run completed
  // cleanly — there's nothing to resume back into.
  const canResumeFromCheckpoint = run.status === 'stopped' || run.status === 'failed';

  return (
    <div className="cruise-run-header">
      <div>
        <h2>Run #{run.id} · {basename(run.target_repo)}</h2>
        <div className="cruise-run-header-meta">{run.target_repo}</div>
      </div>
      <div className="cruise-controls">
        {run.status === 'running' && (
          <>
            <button onClick={onPause} disabled={busy} title="Pause: halt orchestrator but keep CLIs alive">Pause</button>
            <button className="danger" onClick={onStop} disabled={busy} title="Stop: kill agent CLIs, save checkpoint">Stop</button>
          </>
        )}
        {run.status === 'paused' && (
          <>
            <button onClick={onResume} disabled={busy}>Resume</button>
            <button className="danger" onClick={onStop} disabled={busy} title="Stop: kill agent CLIs, save checkpoint">Stop</button>
          </>
        )}
        {canResumeFromCheckpoint && (
          <button onClick={onResume} disabled={busy}>Resume from checkpoint</button>
        )}
        {run.status === 'done' && (
          <span className="cruise-run-done-badge" title="This run finished cleanly. Start a new run to do more work on this repo.">✓ completed</span>
        )}
      </div>
    </div>
  );
}

function PhaseTimeline({ phase, status, reviewCycle }: { phase: string; status: string; reviewCycle: number }) {
  const idx = PHASES.findIndex(p => p.key === phase);
  return (
    <div className="cruise-timeline">
      {PHASES.map((p, i) => {
        const state = i < idx ? 'past' : i === idx ? 'current' : 'future';
        return (
          <div key={p.key} className={`cruise-timeline-step ${state}`}>
            <div className="cruise-timeline-dot" />
            <div className="cruise-timeline-label">{p.label}{p.key === 'review' && reviewCycle > 0 ? ` · cycle ${reviewCycle}` : ''}</div>
          </div>
        );
      })}
      <div className="cruise-timeline-status">status: {status}</div>
    </div>
  );
}

interface MessageStats {
  sent: number;
  received: number;
  lastDirection: 'sent' | 'received' | null;
  lastPeer: string | null;
  lastPreview: string | null;
}

interface TaskStats {
  assigned: number;
  created: number;
}

function AgentCard({ agent, attentionReason, focused, onFocus, messageStats, taskStats }: {
  agent: CruiseAgent;
  attentionReason: string | null | undefined;
  focused: boolean;
  onFocus: () => void;
  messageStats?: MessageStats;
  taskStats?: TaskStats;
}) {
  const stat = STATUS_STYLES[agent.status] || { color: '#888', label: agent.status };
  return (
    <div className={`cruise-agent-card ${focused ? 'focused' : ''} ${attentionReason ? 'attention' : ''}`} onClick={onFocus}>
      <div className="cruise-agent-role">{agent.label || agent.role}</div>
      <div className="cruise-agent-program">{agent.program_id}</div>
      <div className="cruise-agent-status" style={{ color: stat.color }}>
        <span className="cruise-agent-dot" style={{ background: stat.color }} />
        {stat.label}
      </div>
      {messageStats && (messageStats.sent > 0 || messageStats.received > 0) && (
        <div className="cruise-agent-msgs">
          <span title="messages sent">↗ {messageStats.sent}</span>
          <span title="messages received">↙ {messageStats.received}</span>
          {messageStats.lastPeer && messageStats.lastDirection && (
            <span className="cruise-agent-last-msg">
              {messageStats.lastDirection === 'sent' ? '→' : '←'} {messageStats.lastPeer}
            </span>
          )}
        </div>
      )}
      {taskStats && (taskStats.assigned > 0 || taskStats.created > 0) && (
        <div className="cruise-agent-tasks">
          {taskStats.assigned > 0 && (
            <span className="cruise-task-pill assigned" title="open tasks assigned to this agent">
              ◉ {taskStats.assigned} open
            </span>
          )}
          {taskStats.created > 0 && (
            <span className="cruise-task-pill created" title="tasks raised by this agent">
              ↗ {taskStats.created} raised
            </span>
          )}
        </div>
      )}
      {attentionReason && (
        <div className="cruise-agent-attention">⚠ {attentionReason}</div>
      )}
    </div>
  );
}

function computeTaskStats(role: string, events: CruiseEvent[]): TaskStats {
  let assigned = 0, created = 0;
  // task.created events carry { taskId, from, owner, ... } in payload.
  // We don't have a separate resolved event yet, so "assigned" counts all
  // tasks created for this role (until we wire up task.resolved).
  for (const e of events) {
    if (e.type === 'task.created') {
      if (e.payload?.owner === role) assigned++;
      if (e.payload?.from === role) created++;
    }
  }
  return { assigned, created };
}

function computeMessageStats(role: string, events: CruiseEvent[]): MessageStats {
  let sent = 0, received = 0;
  let lastDirection: 'sent' | 'received' | null = null;
  let lastPeer: string | null = null;
  let lastPreview: string | null = null;
  for (const e of events) {
    if (e.type === 'message.sent' && e.payload?.from === role) {
      sent++;
      lastDirection = 'sent'; lastPeer = e.payload.to; lastPreview = e.payload.bodyPreview;
    } else if (e.type === 'message.routed' && e.payload?.to === role) {
      received++;
      lastDirection = 'received'; lastPeer = e.payload.from; lastPreview = null;
    }
  }
  return { sent, received, lastDirection, lastPeer, lastPreview };
}

function StartDialog({ onCancel, onStart, busy }: {
  onCancel: () => void;
  onStart: (repo: string, opts: { autoApprovePRD: boolean; maxReviewCycles: number }) => void;
  busy: boolean;
}) {
  const [repo, setRepo] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxCycles, setMaxCycles] = useState(3);

  const pickRepo = async () => {
    const result = await window.electronAPI.cruise.pickRepo();
    if (result.path) setRepo(result.path);
  };

  return (
    <div className="cruise-start-overlay">
      <div className="cruise-start-dialog">
        <h2>New Cruise Control Run</h2>
        <p>Pick a repository that contains <code>AGENTS.md</code> and <code>PRD.md</code> in its root.</p>

        <label>Target repository</label>
        <div className="cruise-row">
          <input
            type="text"
            placeholder="/path/to/your/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <button onClick={pickRepo}>Browse…</button>
        </div>

        <label className="cruise-checkbox">
          <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          Auto-approve PRD without human gate (testing)
        </label>

        <label>Max review cycles</label>
        <input
          type="number"
          min={1}
          max={10}
          value={maxCycles}
          onChange={(e) => setMaxCycles(parseInt(e.target.value, 10) || 1)}
        />

        <div className="cruise-start-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="cruise-primary"
            disabled={!repo.trim() || busy}
            onClick={() => onStart(repo.trim(), { autoApprovePRD: autoApprove, maxReviewCycles: maxCycles })}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Utils ─────────────────────────────────────────────────────────

function basename(p: string): string {
  if (!p) return '(unknown)';
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString();
  } catch { return iso; }
}

function previewPayload(payload: any): string {
  if (!payload) return '';
  try {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch { return ''; }
}

/**
 * Returns a predicate that matches the "lead" agent role(s) for a given
 * phase. In multi-agent mode, the build/review phases can have multiple
 * leads (builder-backend, builder-frontend, reviewer-primary, etc.) so we
 * test by role-prefix instead of exact match.
 */
function leadRoleMatcher(phase: string): (role: string) => boolean {
  switch (phase) {
    case 'prd-refine':
    case 'plan-refine':
      return (r) => r === 'prd-refiner';
    case 'build':
    case 'review-feedback':
      return (r) => r.startsWith('builder');
    case 'review':
      return (r) => r.startsWith('reviewer');
    default:
      return () => false;
  }
}

/** Legacy single-role helper for backwards compatibility with one call-site. */
function roleForPhase(phase: string): string | null {
  switch (phase) {
    case 'prd-refine':
    case 'plan-refine':
      return 'prd-refiner';
    default: return null;
  }
}
