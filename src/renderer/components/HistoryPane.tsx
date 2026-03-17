import { useEffect, useState } from 'react';
import './HistoryPane.css';

interface HistoryPaneProps {
  onCommandSelect: (command: any) => void;
  selectedCommandId?: number;
}

export default function HistoryPane({ onCommandSelect, selectedCommandId }: HistoryPaneProps) {
  const [commands, setCommands] = useState<any[]>([]);
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());
  const [explainedCmds, setExplainedCmds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'history' | 'bookmarks'>('history');

  useEffect(() => {
    loadCommands();
    loadBookmarks();
    loadBookmarkedIds();
    loadExplainedCommands();
    const interval = setInterval(loadCommands, 3000);

    const handleCleared = () => {
      setCommands([]);
      setBookmarks([]);
      setBookmarkedIds(new Set());
      setExplainedCmds(new Set());
    };
    window.addEventListener('history-cleared', handleCleared);

    return () => {
      clearInterval(interval);
      window.removeEventListener('history-cleared', handleCleared);
    };
  }, []);

  const loadCommands = async () => {
    try {
      const cmds = await window.electronAPI.dbGetGroupedCommands();
      setCommands(cmds);
    } catch {
      const cmds = await window.electronAPI.dbGetCommands();
      setCommands(cmds);
    }
  };

  const loadBookmarks = async () => {
    const bm = await window.electronAPI.dbGetBookmarks();
    setBookmarks(bm);
  };

  const loadBookmarkedIds = async () => {
    try {
      const ids = await window.electronAPI.dbGetBookmarkedCommandIds();
      setBookmarkedIds(new Set(ids));
    } catch {}
  };

  const loadExplainedCommands = async () => {
    try {
      const inputs = await window.electronAPI.dbGetExplainedCommandInputs();
      setExplainedCmds(new Set(inputs));
    } catch {}
  };

  const toggleBookmark = async (commandId: number, commandInput: string) => {
    try {
      if (bookmarkedIds.has(commandId)) {
        await window.electronAPI.dbUnbookmarkCommand(commandId);
        setBookmarkedIds(prev => { const next = new Set(prev); next.delete(commandId); return next; });
      } else {
        await window.electronAPI.dbBookmarkCommand(commandId, commandInput);
        setBookmarkedIds(prev => new Set(prev).add(commandId));
      }
      loadBookmarks();
    } catch (err) {
      console.error('Bookmark toggle failed:', err);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };


  return (
    <div className="pane history-pane">
      <div className="pane-header">
        <span>History</span>
        <div className="view-tabs">
          <button
            className={view === 'history' ? 'active' : 'secondary'}
            onClick={() => setView('history')}
          >
            Commands
          </button>
          <button
            className={view === 'bookmarks' ? 'active' : 'secondary'}
            onClick={() => setView('bookmarks')}
          >
            Saved
          </button>
        </div>
      </div>

      <div className="pane-content">
        {view === 'history' && (
          <div className="command-list">
            {commands.length === 0 && (
              <div className="empty-state"><p>No commands yet. Start typing in the terminal!</p></div>
            )}
            {commands.map((cmd) => (
              <div
                key={cmd.id}
                className={`command-item ${selectedCommandId === cmd.id ? 'selected' : ''}`}
                onClick={() => onCommandSelect(cmd)}
              >
                <div className="command-header">
                  <code>{cmd.input}</code>
                  <button
                    className={`bookmark-btn ${bookmarkedIds.has(cmd.id) ? 'bookmarked' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleBookmark(cmd.id, cmd.input); }}
                    title={bookmarkedIds.has(cmd.id) ? 'Remove bookmark' : 'Bookmark'}
                  >
                    {bookmarkedIds.has(cmd.id) ? '★' : '☆'}
                  </button>
                </div>
                <div className="command-meta">
                  <span className="timestamp">{formatTimestamp(cmd.last_used || cmd.timestamp)}</span>
                  {cmd.use_count > 1 && (
                    <span className="use-count">{cmd.use_count}x</span>
                  )}
                  {explainedCmds.has(cmd.input) && (
                    <span className="explained-badge" title="Explanation available">explained</span>
                  )}
                  <span className="working-dir">{cmd.working_dir}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'bookmarks' && (
          <div className="bookmark-list">
            {bookmarks.length === 0 && (
              <div className="empty-state"><p>No bookmarks yet. Click the star on any command to save it!</p></div>
            )}
            {bookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className="bookmark-item"
                onClick={() => onCommandSelect(bookmark)}
              >
                <h4>{bookmark.title}</h4>
                <code>{bookmark.input}</code>
                {bookmark.notes && <p className="notes">{bookmark.notes}</p>}
                {bookmark.tags && (
                  <div className="tags">
                    {JSON.parse(bookmark.tags).map((tag: string) => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
