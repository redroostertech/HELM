import { useState, useEffect } from 'react';
import './SessionsPane.css';

interface SessionsPaneProps {
  isOpen: boolean;
  activeTabId: string;
}

export default function SessionsPane({ isOpen, activeTabId }: SessionsPaneProps) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [sessionCommands, setSessionCommands] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) loadSessions();
  }, [isOpen]);

  const loadSessions = async () => {
    try {
      const s = await window.electronAPI.dbGetSessions();
      setSessions(s);
    } catch {}
  };

  const openSession = async (session: any) => {
    setActiveSession(session);
    try {
      const cmds = await window.electronAPI.dbGetSessionCommands(session.id);
      setSessionCommands(cmds);
    } catch {
      setSessionCommands([]);
    }
  };

  const resumeSession = (session: any) => {
    // Navigate to the session's working directory
    const dir = session.working_dir;
    if (dir) {
      window.electronAPI.ptyWrite(activeTabId, `cd ${dir}\r`);
    }
  };

  const rerunCommand = (cmd: any) => {
    window.electronAPI.ptyWrite(activeTabId, cmd.input + '\r');
  };

  const copyCommand = async (cmd: any) => {
    await navigator.clipboard.writeText(cmd.input);
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return 'Active now';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (mins < 1) return '<1 min';
    if (mins < 60) return `${mins} min`;
    return `${hours}h ${mins % 60}m`;
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' +
        date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit'
    });
  };

  if (!isOpen) return null;

  // Session detail view
  if (activeSession) {
    return (
      <div className="sessions-pane">
        <div className="sessions-header">
          <button className="sessions-header-btn" onClick={() => setActiveSession(null)} title="Back">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className="sessions-header-title">Session Detail</span>
          <button
            className="sessions-resume-btn"
            onClick={() => resumeSession(activeSession)}
            title="Resume — cd into this session's directory"
          >
            Resume
          </button>
        </div>

        <div className="session-info">
          <div className="session-info-row">
            <span className="session-info-label">Started</span>
            <span>{formatDate(activeSession.started_at)}</span>
          </div>
          <div className="session-info-row">
            <span className="session-info-label">Duration</span>
            <span>{formatDuration(activeSession.started_at, activeSession.ended_at)}</span>
          </div>
          <div className="session-info-row">
            <span className="session-info-label">Directory</span>
            <span className="session-info-dir">{activeSession.working_dir}</span>
          </div>
          <div className="session-info-row">
            <span className="session-info-label">Commands</span>
            <span>{sessionCommands.length}</span>
          </div>
        </div>

        <div className="session-timeline">
          {sessionCommands.map((cmd, i) => (
            <div key={cmd.id} className="timeline-item">
              <div className="timeline-line">
                <div className="timeline-dot" />
                {i < sessionCommands.length - 1 && <div className="timeline-connector" />}
              </div>
              <div className="timeline-content">
                <div className="timeline-command">
                  <code>{cmd.input}</code>
                  <div className="timeline-actions">
                    <button
                      className="timeline-btn"
                      onClick={() => copyCommand(cmd)}
                      title="Copy"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </button>
                    <button
                      className="timeline-btn"
                      onClick={() => rerunCommand(cmd)}
                      title="Run in terminal"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <span className="timeline-time">{formatTime(cmd.timestamp)}</span>
              </div>
            </div>
          ))}
          {sessionCommands.length === 0 && (
            <div className="sessions-empty">No commands recorded in this session.</div>
          )}
        </div>
      </div>
    );
  }

  // Sessions list view
  return (
    <div className="sessions-pane">
      <div className="sessions-header">
        <span className="sessions-header-title">Terminal Sessions</span>
      </div>

      <div className="sessions-list">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="sessions-card"
            onClick={() => openSession(session)}
          >
            <div className="sessions-card-header">
              <div className="sessions-card-status">
                <span className={`sessions-card-dot ${session.ended_at ? '' : 'active'}`} />
                <span className="sessions-card-date">{formatDate(session.started_at)}</span>
              </div>
              <span className="sessions-card-duration">
                {formatDuration(session.started_at, session.ended_at)}
              </span>
            </div>

            <div className="sessions-card-dir">{session.working_dir}</div>

            <div className="sessions-card-meta">
              <span>{session.command_count} commands</span>
            </div>

            {session.top_commands?.length > 0 && (
              <div className="sessions-card-preview">
                {session.top_commands.slice(0, 3).map((cmd: string, i: number) => (
                  <code key={i}>{cmd}</code>
                ))}
              </div>
            )}
          </div>
        ))}

        {sessions.length === 0 && (
          <div className="sessions-empty">No terminal sessions yet. Start using the terminal!</div>
        )}
      </div>
    </div>
  );
}
