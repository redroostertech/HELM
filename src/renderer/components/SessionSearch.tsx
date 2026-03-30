import { useState, useEffect, useRef, useCallback } from 'react';
import './SessionSearch.css';

interface SearchResult {
  resultType: 'command' | 'cli_input';
  resultId: number;
  title: string;
  preview: string | null;
  resultTime: string;
  sessionId: number;
  sessionDir: string;
  cliProgramId: string | null;
  cliProgramName: string | null;
  cliProgramColor: string | null;
  cliSessionId: number | null;
}

interface CLIProgram {
  program_id: string;
  program_name: string;
}

interface SessionSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onJumpToSession: (sessionId: number) => void;
  featureEnabled: boolean;
  onUpgrade: () => void;
}

export default function SessionSearch({
  isOpen,
  onClose,
  onJumpToSession,
  featureEnabled,
  onUpgrade,
}: SessionSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [cliProgram, setCLIProgram] = useState('');
  const [cliPrograms, setCLIPrograms] = useState<CLIProgram[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 50;

  // Focus input when opened
  useEffect(() => {
    if (isOpen && featureEnabled) {
      setTimeout(() => inputRef.current?.focus(), 100);
      // Load filter options
      loadFilterOptions();
    }
    if (!isOpen) {
      // Reset state on close
      setQuery('');
      setResults([]);
      setTotal(0);
      setOffset(0);
      setShowFilters(false);
      setDateFrom('');
      setDateTo('');
      setSessionId('');
      setCLIProgram('');
    }
  }, [isOpen, featureEnabled]);

  const loadFilterOptions = async () => {
    try {
      const [programs, sess] = await Promise.all([
        window.electronAPI.dbGetDistinctCLIPrograms(),
        window.electronAPI.dbGetSessions(),
      ]);
      setCLIPrograms(programs);
      setSessions(sess);
    } catch {
      // Non-critical
    }
  };

  const doSearch = useCallback(async (searchQuery: string, searchOffset: number, append: boolean = false) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    try {
      const params: any = {
        query: searchQuery.trim(),
        limit: LIMIT,
        offset: searchOffset,
      };
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (sessionId) params.sessionId = parseInt(sessionId, 10);
      if (cliProgram) params.cliProgram = cliProgram;

      const response = await window.electronAPI.dbSearchAll(params);
      if (append) {
        setResults(prev => [...prev, ...response.results]);
      } else {
        setResults(response.results);
      }
      setTotal(response.total);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, sessionId, cliProgram]);

  // Debounced search on query change
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    setOffset(0);
    searchTimeout.current = setTimeout(() => {
      doSearch(query, 0, false);
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, doSearch]);

  const handleLoadMore = () => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    doSearch(query, newOffset, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const highlightMatch = (text: string, q: string): React.ReactNode => {
    if (!q.trim() || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  const formatTime = (timestamp: string) => {
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

  if (!isOpen) return null;

  // Upgrade prompt when feature is gated
  if (!featureEnabled) {
    return (
      <div className="search-overlay" onClick={onClose}>
        <div className="search-modal search-upgrade" onClick={(e) => e.stopPropagation()}>
          <div className="search-upgrade-content">
            <div className="search-upgrade-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h2>Session Search</h2>
            <p>
              Full-text search across all your terminal sessions, commands, and CLI conversations.
              Find exactly where something happened.
            </p>
            <ul className="search-upgrade-features">
              <li>Search command text and output</li>
              <li>Search CLI conversations (Claude, GPT, etc.)</li>
              <li>Filter by date, session, or CLI program</li>
              <li>Jump directly to session context</li>
            </ul>
            <div className="search-upgrade-actions">
              <button className="search-upgrade-btn" onClick={onUpgrade}>
                Upgrade to Unlock
              </button>
              <button className="search-upgrade-dismiss" onClick={onClose}>
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search input */}
        <div className="search-input-row">
          <div className="search-input-wrapper">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              className="search-input"
              type="text"
              placeholder="Search commands, output, CLI conversations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button className="search-clear-btn" onClick={() => setQuery('')} title="Clear">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          <button
            className={`search-filter-toggle ${showFilters ? 'active' : ''}`}
            onClick={() => setShowFilters(!showFilters)}
            title="Filters"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
          </button>
          <button className="search-close-btn" onClick={onClose} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="search-filters">
            <div className="search-filter-row">
              <label>From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <label>To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="search-filter-row">
              <label>Session</label>
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">All sessions</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id} - {s.working_dir} ({s.command_count} cmds)
                  </option>
                ))}
              </select>
              <label>CLI</label>
              <select value={cliProgram} onChange={(e) => setCLIProgram(e.target.value)}>
                <option value="">All programs</option>
                {cliPrograms.map(p => (
                  <option key={p.program_id} value={p.program_id}>
                    {p.program_name}
                  </option>
                ))}
              </select>
            </div>
            {(dateFrom || dateTo || sessionId || cliProgram) && (
              <button
                className="search-clear-filters"
                onClick={() => { setDateFrom(''); setDateTo(''); setSessionId(''); setCLIProgram(''); }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Results */}
        <div className="search-results" ref={resultsRef}>
          {loading && results.length === 0 && (
            <div className="search-loading">Searching...</div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="search-empty">
              No results found for "{query}"
            </div>
          )}

          {!query.trim() && !loading && (
            <div className="search-empty">
              <div className="search-empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </div>
              <p>Search across all sessions, commands, and CLI conversations</p>
              <div className="search-hint">
                <kbd>Esc</kbd> to close
              </div>
            </div>
          )}

          {results.map((result) => (
            <div
              key={`${result.resultType}-${result.resultId}`}
              className="search-result-item"
              onClick={() => onJumpToSession(result.sessionId)}
            >
              <div className="search-result-header">
                <div className="search-result-type">
                  {result.resultType === 'command' ? (
                    <span className="search-type-badge search-type-command">CMD</span>
                  ) : (
                    <span
                      className="search-type-badge search-type-cli"
                      style={result.cliProgramColor ? {
                        background: result.cliProgramColor + '20',
                        color: result.cliProgramColor,
                        borderColor: result.cliProgramColor + '40',
                      } : undefined}
                    >
                      {result.cliProgramName || 'CLI'}
                    </span>
                  )}
                </div>
                <div className="search-result-title">
                  <code>{highlightMatch(result.title, query)}</code>
                </div>
                <span className="search-result-time">{formatTime(result.resultTime)}</span>
              </div>
              {result.preview && (
                <div className="search-result-preview">
                  {highlightMatch(
                    result.preview.length > 150
                      ? result.preview.slice(0, 150) + '...'
                      : result.preview,
                    query
                  )}
                </div>
              )}
              <div className="search-result-meta">
                <span className="search-result-session" title="Jump to session">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                  Session #{result.sessionId}
                </span>
                <span className="search-result-dir">{result.sessionDir}</span>
              </div>
            </div>
          ))}

          {results.length > 0 && results.length < total && (
            <div className="search-load-more">
              <button onClick={handleLoadMore} disabled={loading}>
                {loading ? 'Loading...' : `Load more (${results.length} of ${total})`}
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="search-result-count">
              {total} result{total !== 1 ? 's' : ''} found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
