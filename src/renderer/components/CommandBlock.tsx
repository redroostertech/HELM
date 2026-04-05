import { useState, useRef, useEffect, useCallback } from 'react';
import './CommandBlock.css';

const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const IconRun = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 5v14l12-7z" />
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const IconUp = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m18 15-6-6-6 6" />
  </svg>
);

const IconDown = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms' }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export interface StepData {
  id: string;
  command: string;
  output: string;
  isActive?: boolean;
}

interface CommandBlockProps {
  step: StepData;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  theme: 'dark' | 'light';
  onEdit: (id: string, command: string) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

export default function CommandBlock({ step, index, isFirst, isLast, theme, onEdit, onDelete, onRun, onMoveUp, onMoveDown }: CommandBlockProps) {
  const [collapsed, setCollapsed] = useState(!step.output);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(!step.command);
  const [draft, setDraft] = useState(step.command);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => { setDraft(step.command); }, [step.command]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (step.isActive && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [step.output, step.isActive]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed !== step.command) onEdit(step.id, trimmed);
    setEditing(false);
  }, [draft, step.command, step.id, onEdit]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(step.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [step.command]);

  return (
    <div className={`command-block ${step.isActive ? 'cb-active' : ''}`} data-theme={theme}>
      <div className="cb-header">
        <span className="cb-step-num">{index + 1}</span>
        <div className="cb-reorder">
          <button className="cb-reorder-btn" onClick={() => onMoveUp(step.id)} disabled={isFirst} title="Move up" aria-label="Move up">
            <IconUp />
          </button>
          <button className="cb-reorder-btn" onClick={() => onMoveDown(step.id)} disabled={isLast} title="Move down" aria-label="Move down">
            <IconDown />
          </button>
        </div>
        {step.output && (
          <button className="cb-toggle" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Show output' : 'Hide output'}>
            <IconChevron open={!collapsed} />
          </button>
        )}
        <span className="cb-meta">
          {step.isActive && <span className="cb-running">running</span>}
        </span>
        <div className="cb-actions">
          <button
            className="cb-action-btn cb-action-run"
            onClick={() => onRun(step.id)}
            disabled={!step.command.trim() || step.isActive}
            title="Run this step"
            aria-label="Run this step"
          >
            <IconRun />
          </button>
          <button className="cb-action-btn" onClick={handleCopy} disabled={!step.command.trim()} title="Copy command" aria-label="Copy command">
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
          <button className="cb-action-btn cb-action-delete" onClick={() => onDelete(step.id)} title="Delete step" aria-label="Delete step">
            <IconTrash />
          </button>
        </div>
      </div>

      <div className="cb-body">
        {editing ? (
          <textarea
            ref={inputRef}
            className="cb-cmd-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setDraft(step.command); setEditing(false); }
            }}
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            spellCheck={false}
            placeholder="Enter a command…"
          />
        ) : (
          <pre
            className="cb-command"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            <span className="cb-prompt">$</span> {step.command || <span className="cb-placeholder">click to enter command…</span>}
          </pre>
        )}

        {step.output && !collapsed && (
          <pre ref={outputRef} className="cb-output">{step.output}</pre>
        )}
      </div>
    </div>
  );
}
