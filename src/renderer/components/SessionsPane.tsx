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
  const [expandedCLI, setExpandedCLI] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isOpen) loadSessions();
    // Poll for session updates while open
    if (isOpen) {
      const interval = setInterval(loadSessions, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleCleared = () => {
      setSessions([]);
      setActiveSession(null);
      setSessionCommands([]);
    };
    window.addEventListener('history-cleared', handleCleared);
    return () => window.removeEventListener('history-cleared', handleCleared);
  }, []);

  const loadSessions = async () => {
    try {
      const s = await window.electronAPI.dbGetSessions();
      setSessions(s);
    } catch {}
  };

  const loadSessionCommands = async (sessionId: number) => {
    try {
      const cmds = await window.electronAPI.dbGetSessionCommandsWithCLI(sessionId);
      setSessionCommands(cmds);
    } catch {
      try {
        const cmds = await window.electronAPI.dbGetSessionCommands(sessionId);
        setSessionCommands(cmds);
      } catch {
        setSessionCommands([]);
      }
    }
  };

  // Poll session detail while viewing one
  useEffect(() => {
    if (activeSession) {
      const interval = setInterval(() => loadSessionCommands(activeSession.id), 3000);
      return () => clearInterval(interval);
    }
  }, [activeSession]);

  const openSession = async (session: any) => {
    setActiveSession(session);
    setExpandedCLI(new Set());
    try {
      const cmds = await window.electronAPI.dbGetSessionCommandsWithCLI(session.id);
      setSessionCommands(cmds);
    } catch {
      // Fallback to regular commands if CLI method not available
      try {
        const cmds = await window.electronAPI.dbGetSessionCommands(session.id);
        setSessionCommands(cmds);
      } catch {
        setSessionCommands([]);
      }
    }
  };

  const resumeSession = async (session: any) => {
    const dir = session.working_dir;
    // Reattach this tab to the resumed session
    await window.electronAPI.ptyResumeSession(activeTabId, session.id, dir);
    // cd into the session's working directory
    if (dir) {
      window.electronAPI.ptyWrite(activeTabId, `cd ${dir}\r`);
    }
  };

  const rerunCommand = (cmd: any) => {
    window.electronAPI.ptyWrite(activeTabId, cmd.input + '\r');
  };

  const deleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await window.electronAPI.dbDeleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setSessionCommands([]);
      }
    } catch {}
  };

  const copyCommand = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const toggleCLIExpanded = (cliSessionId: number) => {
    setExpandedCLI(prev => {
      const next = new Set(prev);
      if (next.has(cliSessionId)) {
        next.delete(cliSessionId);
      } else {
        next.add(cliSessionId);
      }
      return next;
    });
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

    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) {
      return 'Today ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
          <div className="sessions-header-actions">
            <button
              className="sessions-header-btn"
              onClick={() => loadSessionCommands(activeSession.id)}
              title="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button
              className="sessions-detail-delete-btn"
              onClick={(e) => deleteSession(activeSession.id, e)}
              title="Delete session"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <button
              className="sessions-resume-btn"
              onClick={() => resumeSession(activeSession)}
              title="Resume — cd into this session's directory"
            >
              Resume
            </button>
          </div>
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
          {sessionCommands.map((cmd, i) => {
            const hasCLI = cmd.cli_session;
            const isExpanded = hasCLI && expandedCLI.has(cmd.cli_session.id);

            return (
              <div key={cmd.id} className="timeline-item-wrapper">
                {/* The command itself */}
                <div className={`timeline-item ${hasCLI ? 'timeline-item-cli' : ''}`}>
                  <div className="timeline-line">
                    <div
                      className={`timeline-dot ${hasCLI ? 'timeline-dot-cli' : ''}`}
                      style={hasCLI ? { background: cmd.cli_session.program_color } : undefined}
                    />
                    {(i < sessionCommands.length - 1 || (hasCLI && isExpanded)) && (
                      <div
                        className="timeline-connector"
                        style={hasCLI && isExpanded ? { background: cmd.cli_session.program_color + '40' } : undefined}
                      />
                    )}
                  </div>
                  <div className="timeline-content">
                    <div className="timeline-command">
                      {hasCLI && (
                        <button
                          className="timeline-cli-toggle"
                          onClick={() => toggleCLIExpanded(cmd.cli_session.id)}
                          title={isExpanded ? 'Collapse' : 'Expand inputs'}
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 24 24"
                            fill="none" stroke="currentColor" strokeWidth="2.5"
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                          >
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                        </button>
                      )}
                      <code>{cmd.input}</code>
                      {hasCLI && (
                        <span
                          className="timeline-cli-badge"
                          style={{ background: cmd.cli_session.program_color + '20', color: cmd.cli_session.program_color, borderColor: cmd.cli_session.program_color + '40' }}
                        >
                          {cmd.cli_session.program_name}
                          {cmd.cli_session.input_count > 0 && (
                            <span className="timeline-cli-count">{cmd.cli_session.input_count}</span>
                          )}
                        </span>
                      )}
                      <div className="timeline-actions">
                        <button
                          className="timeline-btn"
                          onClick={() => copyCommand(cmd.input)}
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

                {/* Expanded CLI inputs */}
                {hasCLI && isExpanded && cmd.cli_session.inputs && (
                  <div className="timeline-cli-inputs">
                    {cmd.cli_session.inputs.map((input: any, j: number) => (
                      <div key={input.id} className="timeline-cli-input-item">
                        <div className="timeline-line">
                          <div
                            className="timeline-cli-input-dot"
                            style={{ borderColor: cmd.cli_session.program_color + '80' }}
                          />
                          {j < cmd.cli_session.inputs.length - 1 && (
                            <div
                              className="timeline-connector"
                              style={{ background: cmd.cli_session.program_color + '20' }}
                            />
                          )}
                        </div>
                        <div className="timeline-content">
                          <div className="timeline-command">
                            <span className="timeline-cli-input-text">"{input.input}"</span>
                            <div className="timeline-actions">
                              <button
                                className="timeline-btn"
                                onClick={() => copyCommand(input.input)}
                                title="Copy prompt"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                          <span className="timeline-time">{formatTime(input.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                    {cmd.cli_session.ended_at && (
                      <div className="timeline-cli-exit">
                        <div className="timeline-line">
                          <div className="timeline-cli-exit-dot" />
                        </div>
                        <div className="timeline-content">
                          <span className="timeline-cli-exit-text">exited</span>
                          <span className="timeline-time">{formatTime(cmd.cli_session.ended_at)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
              <div className="sessions-card-actions">
                <span className="sessions-card-duration">
                  {formatDuration(session.started_at, session.ended_at)}
                </span>
                <button
                  className="sessions-delete-btn"
                  onClick={(e) => deleteSession(session.id, e)}
                  title="Delete session"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
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
