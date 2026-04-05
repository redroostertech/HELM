import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import CommandBlock, { StepData } from './CommandBlock';
import './CommandBlockOverlay.css';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

interface Playbook {
  id: string;
  name: string;
  steps: StepData[];
  createdAt: string;
  updatedAt: string;
}

interface CommandBlockOverlayProps {
  tabId: string;
  theme: 'dark' | 'light';
  isVisible: boolean;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

const storageKey = (tabId: string) => `helm.playbooks.${tabId}`;
const selectedKey = (tabId: string) => `helm.playbooks.selected.${tabId}`;

function loadPlaybooks(tabId: string): Playbook[] {
  try {
    const raw = localStorage.getItem(storageKey(tabId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Playbook[];
    return parsed.map(p => ({
      ...p,
      steps: p.steps.map(s => ({ ...s, isActive: false })),
    }));
  } catch { return []; }
}

function savePlaybooks(tabId: string, playbooks: Playbook[]) {
  try {
    const clean = playbooks.map(p => ({
      ...p,
      steps: p.steps.map(s => ({ ...s, isActive: false })),
    }));
    localStorage.setItem(storageKey(tabId), JSON.stringify(clean));
  } catch {}
}

export default function CommandBlockOverlay({ tabId, theme, isVisible }: CommandBlockOverlayProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>(() => loadPlaybooks(tabId));
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem(selectedKey(tabId)));
  const [maximized, setMaximized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const [promptState, setPromptState] = useState<{
    title: string;
    value: string;
    onConfirm: (value: string) => void;
  } | null>(null);

  const askText = (title: string, initial: string, onConfirm: (v: string) => void) => {
    setPromptState({ title, value: initial, onConfirm });
  };
  const containerRef = useRef<HTMLDivElement>(null);

  // Track which step is currently producing output
  const activeStepIdRef = useRef<string | null>(null);
  const activePlaybookIdRef = useRef<string | null>(null);
  const outputBufferRef = useRef<string>('');

  const selected = useMemo(
    () => playbooks.find(p => p.id === selectedId) || null,
    [playbooks, selectedId]
  );

  const filteredPlaybooks = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return playbooks;
    return playbooks.filter(p => p.name.toLowerCase().includes(q));
  }, [playbooks, pickerQuery]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [pickerOpen]);

  // Reload when tab changes
  useEffect(() => {
    const pbs = loadPlaybooks(tabId);
    setPlaybooks(pbs);
    setSelectedId(localStorage.getItem(selectedKey(tabId)));
    activeStepIdRef.current = null;
    activePlaybookIdRef.current = null;
    outputBufferRef.current = '';
  }, [tabId]);

  // Persist + show "Saved" indicator after changes
  const [savedFlash, setSavedFlash] = useState(false);
  const firstRenderRef = useRef(true);
  useEffect(() => {
    savePlaybooks(tabId, playbooks);
    if (firstRenderRef.current) { firstRenderRef.current = false; return; }
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1200);
    return () => clearTimeout(t);
  }, [tabId, playbooks]);
  useEffect(() => {
    if (selectedId) localStorage.setItem(selectedKey(tabId), selectedId);
    else localStorage.removeItem(selectedKey(tabId));
  }, [tabId, selectedId]);

  // ── PTY output capture ────────────────────────────────────────────
  const flushOutput = () => {
    const stepId = activeStepIdRef.current;
    const pbId = activePlaybookIdRef.current;
    const chunk = outputBufferRef.current;
    if (!stepId || !pbId || !chunk) return;
    outputBufferRef.current = '';
    setPlaybooks(prev => prev.map(p =>
      p.id !== pbId ? p : {
        ...p,
        steps: p.steps.map(s => s.id === stepId ? { ...s, output: s.output + chunk } : s),
      }
    ));
  };

  const handlePtyData = useCallback((_tabId: string, data: string) => {
    if (_tabId !== tabId) return;
    if (!activeStepIdRef.current) return;
    const clean = stripAnsi(data).replace(/[^\n]*\r(?!\n)/g, '');
    outputBufferRef.current += clean;
    if (clean.includes('\n')) flushOutput();
  }, [tabId]);

  // Auto-capture: add terminal-typed commands as new steps (only when recording)
  const handleCommandCaptured = useCallback((_tabId: string, command: string) => {
    if (_tabId !== tabId) return;
    if (activeStepIdRef.current) return; // we initiated this command ourselves
    if (!recording || !selectedId) return;

    const stepId = nextId('step');
    activeStepIdRef.current = stepId;
    activePlaybookIdRef.current = selectedId;
    setPlaybooks(prev => prev.map(p =>
      p.id !== selectedId ? p : {
        ...p,
        updatedAt: new Date().toISOString(),
        steps: [...p.steps, { id: stepId, command, output: '', isActive: true }],
      }
    ));
  }, [tabId, recording, selectedId]);

  useEffect(() => {
    const c1 = window.electronAPI.onPtyData(handlePtyData);
    const c2 = window.electronAPI.onPtyCommandCaptured(handleCommandCaptured);
    return () => { c1(); c2(); };
  }, [handlePtyData, handleCommandCaptured]);

  // Finalize active step after output settles
  useEffect(() => {
    if (!activeStepIdRef.current) return;
    const stepId = activeStepIdRef.current;
    const pbId = activePlaybookIdRef.current;
    const t = setTimeout(() => {
      if (activeStepIdRef.current !== stepId) return;
      flushOutput();
      setPlaybooks(prev => prev.map(p =>
        p.id !== pbId ? p : {
          ...p,
          steps: p.steps.map(s => s.id === stepId ? { ...s, isActive: false } : s),
        }
      ));
      activeStepIdRef.current = null;
      activePlaybookIdRef.current = null;
    }, 800);
    return () => clearTimeout(t);
  }, [playbooks]);

  // ── Playbook actions ──────────────────────────────────────────────
  const handleNewPlaybook = useCallback(() => {
    askText('New playbook name', 'New Playbook', (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const id = nextId('pb');
      const now = new Date().toISOString();
      const pb: Playbook = { id, name: trimmed, steps: [], createdAt: now, updatedAt: now };
      setPlaybooks(prev => [...prev, pb]);
      setSelectedId(id);
    });
  }, []);

  const handleRenamePlaybook = useCallback(() => {
    if (!selected) return;
    const sel = selected;
    askText('Rename playbook', sel.name, (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setPlaybooks(prev => prev.map(p => p.id === sel.id ? { ...p, name: trimmed, updatedAt: new Date().toISOString() } : p));
    });
  }, [selected]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const handleDeletePlaybook = useCallback(() => {
    if (!selected) return;
    setConfirmDelete(true);
  }, [selected]);

  const doDeletePlaybook = useCallback(() => {
    if (!selected) return;
    const sel = selected;
    setPlaybooks(prev => prev.filter(p => p.id !== sel.id));
    setSelectedId(() => {
      const remaining = playbooks.filter(p => p.id !== sel.id);
      return remaining[0]?.id || null;
    });
    setConfirmDelete(false);
  }, [selected, playbooks]);

  const handleDuplicatePlaybook = useCallback(() => {
    if (!selected) return;
    const id = nextId('pb');
    const now = new Date().toISOString();
    const copy: Playbook = {
      id,
      name: `${selected.name} (copy)`,
      steps: selected.steps.map(s => ({ id: nextId('step'), command: s.command, output: '', isActive: false })),
      createdAt: now,
      updatedAt: now,
    };
    setPlaybooks(prev => [...prev, copy]);
    setSelectedId(id);
  }, [selected]);

  const handleRunPlaybook = useCallback(() => {
    if (!selected || selected.steps.length === 0) return;
    const chained = selected.steps.map(s => s.command.trim()).filter(Boolean).join(' && ');
    if (!chained) return;
    // Clear outputs, mark first step active (chained output all goes to first)
    setPlaybooks(prev => prev.map(p =>
      p.id !== selected.id ? p : {
        ...p,
        steps: p.steps.map((s, i) => ({ ...s, output: '', isActive: i === 0 })),
      }
    ));
    activeStepIdRef.current = selected.steps[0].id;
    activePlaybookIdRef.current = selected.id;
    outputBufferRef.current = '';
    window.electronAPI.ptyWrite(tabId, chained + '\r');
  }, [selected, tabId]);

  // ── Step actions ──────────────────────────────────────────────────
  const withSelected = useCallback((fn: (p: Playbook) => Playbook) => {
    if (!selected) return;
    setPlaybooks(prev => prev.map(p => p.id === selected.id ? fn({ ...p, updatedAt: new Date().toISOString() }) : p));
  }, [selected]);

  const handleAddStep = useCallback(() => {
    withSelected(p => ({ ...p, steps: [...p.steps, { id: nextId('step'), command: '', output: '', isActive: false }] }));
  }, [withSelected]);

  const handleEditStep = useCallback((stepId: string, command: string) => {
    withSelected(p => ({ ...p, steps: p.steps.map(s => s.id === stepId ? { ...s, command } : s) }));
  }, [withSelected]);

  const handleDeleteStep = useCallback((stepId: string) => {
    withSelected(p => ({ ...p, steps: p.steps.filter(s => s.id !== stepId) }));
    if (activeStepIdRef.current === stepId) activeStepIdRef.current = null;
  }, [withSelected]);

  const handleRunStep = useCallback((stepId: string) => {
    if (!selected) return;
    const step = selected.steps.find(s => s.id === stepId);
    if (!step || !step.command.trim()) return;
    withSelected(p => ({ ...p, steps: p.steps.map(s => s.id === stepId ? { ...s, output: '', isActive: true } : s) }));
    activeStepIdRef.current = stepId;
    activePlaybookIdRef.current = selected.id;
    outputBufferRef.current = '';
    window.electronAPI.ptyWrite(tabId, step.command + '\r');
  }, [selected, withSelected, tabId]);

  const handleMoveStep = useCallback((stepId: string, delta: -1 | 1) => {
    withSelected(p => {
      const idx = p.steps.findIndex(s => s.id === stepId);
      if (idx < 0) return p;
      const target = idx + delta;
      if (target < 0 || target >= p.steps.length) return p;
      const next = [...p.steps];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...p, steps: next };
    });
  }, [withSelected]);

  if (!isVisible) return null;

  return (
    <div className={`cb-overlay ${maximized ? 'cb-overlay-maximized' : ''}`} ref={containerRef} data-theme={theme}>
      {/* Playbook toolbar */}
      <div className="cb-overlay-header">
        <div className="cb-picker" ref={pickerRef}>
          <button
            className="cb-playbook-select"
            onClick={() => { setPickerOpen(o => !o); setPickerQuery(''); }}
            disabled={playbooks.length === 0}
            title={selected ? selected.name : 'Select a playbook'}
          >
            <span className="cb-picker-label">
              {selected ? `${selected.name} (${selected.steps.length})` : (playbooks.length === 0 ? 'No playbooks' : 'Select a playbook…')}
            </span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {pickerOpen && (
            <div className="cb-picker-popover">
              <input
                autoFocus
                className="cb-picker-search"
                placeholder="Search playbooks…"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setPickerOpen(false); return; }
                  if (e.key === 'Enter' && filteredPlaybooks[0]) {
                    setSelectedId(filteredPlaybooks[0].id);
                    setPickerOpen(false);
                  }
                }}
              />
              <div className="cb-picker-list">
                {filteredPlaybooks.length === 0 ? (
                  <div className="cb-picker-empty">No matches</div>
                ) : filteredPlaybooks.map(p => (
                  <button
                    key={p.id}
                    className={`cb-picker-item ${p.id === selectedId ? 'cb-picker-item-active' : ''}`}
                    onClick={() => { setSelectedId(p.id); setPickerOpen(false); }}
                  >
                    <span className="cb-picker-item-name">{p.name}</span>
                    <span className="cb-picker-item-count">{p.steps.length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="cb-overlay-toolbar">
          <button className="cb-overlay-btn cb-overlay-btn-primary" onClick={handleRunPlaybook} disabled={!selected || selected.steps.length === 0} title="Run all steps chained with &&">
            Run
          </button>
          <button className="cb-overlay-btn" onClick={handleNewPlaybook} title="Create new playbook">+ New</button>
          <button
            className="cb-overlay-action"
            onClick={() => setMaximized(m => !m)}
            title={maximized ? 'Restore panel' : 'Maximize panel'}
            aria-label={maximized ? 'Restore panel' : 'Maximize panel'}
          >
            {maximized ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v4a1 1 0 0 1-1 1H3" /><path d="M21 8h-4a1 1 0 0 1-1-1V3" />
                <path d="M3 16h4a1 1 0 0 1 1 1v4" /><path d="M16 21v-4a1 1 0 0 1 1-1h4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Playbook sub-toolbar */}
      {selected && (
        <div className="cb-subtoolbar">
          <button className="cb-sub-btn" onClick={handleRenamePlaybook} title="Rename playbook">Rename</button>
          <button className="cb-sub-btn" onClick={handleDuplicatePlaybook} title="Duplicate playbook">Duplicate</button>
          <button className="cb-sub-btn cb-sub-btn-danger" onClick={handleDeletePlaybook} title="Delete playbook">Delete</button>
          <span className={`cb-saved-indicator ${savedFlash ? 'cb-saved-visible' : ''}`} aria-live="polite">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Saved
          </span>
          <label className="cb-record-toggle" title="Auto-capture terminal commands as new steps">
            <input type="checkbox" checked={recording} onChange={(e) => setRecording(e.target.checked)} />
            <span>Record</span>
          </label>
        </div>
      )}

      {/* Content */}
      {!selected ? (
        <div className="cb-overlay-empty">
          <p>No playbook selected.</p>
          <p className="cb-overlay-empty-hint">Click <strong>+ New</strong> to create a playbook. A playbook is a reusable set of commands you can run in order.</p>
        </div>
      ) : selected.steps.length === 0 ? (
        <div className="cb-overlay-empty">
          <p>No steps in "{selected.name}".</p>
          <p className="cb-overlay-empty-hint">Click <strong>+ Add Step</strong> below to add a command, or toggle <strong>Record</strong> to auto-capture commands you type in the terminal.</p>
          <button className="cb-overlay-btn cb-overlay-btn-primary" onClick={handleAddStep} style={{ marginTop: 12 }}>+ Add Step</button>
        </div>
      ) : (
        <>
          <div className="cb-overlay-list">
            {selected.steps.map((step, i) => (
              <CommandBlock
                key={step.id}
                step={step}
                index={i}
                isFirst={i === 0}
                isLast={i === selected.steps.length - 1}
                theme={theme}
                onEdit={handleEditStep}
                onDelete={handleDeleteStep}
                onRun={handleRunStep}
                onMoveUp={(id) => handleMoveStep(id, -1)}
                onMoveDown={(id) => handleMoveStep(id, 1)}
              />
            ))}
          </div>
          <div className="cb-overlay-footer">
            <button className="cb-overlay-btn" onClick={handleAddStep}>+ Add Step</button>
          </div>
        </>
      )}

      {/* Text prompt modal */}
      {promptState && (
        <div className="cb-modal-backdrop" onClick={() => setPromptState(null)}>
          <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cb-modal-title">{promptState.title}</div>
            <input
              autoFocus
              className="cb-modal-input"
              value={promptState.value}
              onChange={(e) => setPromptState(s => s ? { ...s, value: e.target.value } : s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  promptState.onConfirm(promptState.value);
                  setPromptState(null);
                }
                if (e.key === 'Escape') setPromptState(null);
              }}
            />
            <div className="cb-modal-actions">
              <button className="cb-overlay-btn" onClick={() => setPromptState(null)}>Cancel</button>
              <button className="cb-overlay-btn cb-overlay-btn-primary" onClick={() => { promptState.onConfirm(promptState.value); setPromptState(null); }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && selected && (
        <div className="cb-modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cb-modal-title">Delete playbook?</div>
            <div className="cb-modal-body">Delete "{selected.name}"? This can't be undone.</div>
            <div className="cb-modal-actions">
              <button className="cb-overlay-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="cb-overlay-btn cb-overlay-btn-danger" onClick={doDeletePlaybook}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
