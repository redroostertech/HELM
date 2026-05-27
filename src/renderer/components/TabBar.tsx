import { useState } from 'react';
import './TabBar.css';

export interface TerminalTab {
  id: string;
  label: string;
  description: string;
  memoryMB: number;
  groupId?: string;
  /** When set, tab pulses with this reason text as tooltip (Cruise Control) */
  needsAttention?: string | null;
}

interface TabBarProps {
  tabs: TerminalTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onRenameTab: (id: string, label: string) => void;
  onSettingsClick?: () => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  sessionsOpen?: boolean;
  onToggleSessions?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  cruiseOpen?: boolean;
  onToggleCruise?: () => void;
  appMonitorOpen?: boolean;
  onToggleAppMonitor?: () => void;
}

const MAX_TABS = 7;

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, onRenameTab, onSettingsClick, chatOpen, onToggleChat, sessionsOpen, onToggleSessions, sidebarOpen, onToggleSidebar, cruiseOpen, onToggleCruise, appMonitorOpen, onToggleAppMonitor }: TabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEditing = (tab: TerminalTab, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(tab.id);
    setEditValue(tab.label);
  };

  const finishEditing = () => {
    if (editingId && editValue.trim()) {
      onRenameTab(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const formatMemory = (mb: number) => {
    if (mb < 1) return '<1 MB';
    return `${Math.round(mb)} MB`;
  };

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === activeTabId ? 'active' : ''} ${tab.needsAttention ? 'needs-attention' : ''}`}
            onClick={() => onSelectTab(tab.id)}
            title={tab.needsAttention || tab.description || tab.label}
          >
            {tab.needsAttention && <span className="tab-attention-dot" aria-label="Needs your input" />}
            <div className="tab-content">
              {editingId === tab.id ? (
                <input
                  className="tab-edit-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={finishEditing}
                  onKeyDown={e => {
                    if (e.key === 'Enter') finishEditing();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="tab-label" onDoubleClick={e => startEditing(tab, e)}>
                  {tab.label}
                </span>
              )}
              {tab.description && editingId !== tab.id && (
                <span className="tab-description">{tab.description}</span>
              )}
            </div>
            <div className="tab-meta">
              <span className="tab-memory">{formatMemory(tab.memoryMB)}</span>
              {tabs.length > 1 && (
                <button
                  className="tab-close"
                  onClick={e => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title="Close tab"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="tab-actions">
        {tabs.length < MAX_TABS && (
          <button className="tab-action-btn" onClick={onNewTab} title="New terminal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        )}

        <div className="tab-separator" />

        {/* Panel toggles */}
        <button
          className={`tab-action-btn ${chatOpen ? 'panel-active' : ''}`}
          onClick={onToggleChat}
          title="Toggle chat"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        <button
          className={`tab-action-btn ${sessionsOpen ? 'panel-active' : ''}`}
          onClick={onToggleSessions}
          title="Terminal sessions"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>

        <button
          className={`tab-action-btn ${sidebarOpen ? 'panel-active' : ''}`}
          onClick={onToggleSidebar}
          title="Command history"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        </button>

        <button
          className={`tab-action-btn ${cruiseOpen ? 'panel-active' : ''}`}
          onClick={onToggleCruise}
          title="Cruise Control (agentic orchestration)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 12.5l5-2.5-3-5-5 2.5z"/>
            <path d="M3 21l3-5"/>
            <path d="M21 3l-5 3"/>
            <circle cx="9" cy="14" r="4"/>
          </svg>
        </button>

        <button
          className={`tab-action-btn ${appMonitorOpen ? 'panel-active' : ''}`}
          onClick={onToggleAppMonitor}
          title="AppMonitor (live runtime observability)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
            <circle cx="11" cy="10" r="3"/>
            <line x1="13.2" y1="12.2" x2="15.5" y2="14.5"/>
          </svg>
        </button>

        <button className="tab-action-btn" onClick={onSettingsClick} title="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
