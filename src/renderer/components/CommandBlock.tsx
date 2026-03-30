import { useState, useRef, useEffect, useCallback } from 'react';
import './CommandBlock.css';

export interface CommandBlockData {
  id: string;
  command: string;
  output: string;
  timestamp: Date;
  exitCode?: number;
  workingDir?: string;
  isActive?: boolean; // true if command is still running
}

interface CommandBlockProps {
  block: CommandBlockData;
  isSelected: boolean;
  onSelect: (id: string) => void;
  theme: 'dark' | 'light';
}

export default function CommandBlock({ block, isSelected, onSelect, theme }: CommandBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Auto-scroll to bottom while command is active
  useEffect(() => {
    if (block.isActive && outputRef.current && !collapsed) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [block.output, block.isActive, collapsed]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = block.output
      ? `$ ${block.command}\n${block.output}`
      : `$ ${block.command}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [block.command, block.output]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed(prev => !prev);
  }, []);

  const handleSearchToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowSearch(prev => !prev);
    if (showSearch) {
      setSearchTerm('');
    }
  }, [showSearch]);

  const highlightOutput = (text: string, term: string): React.ReactNode => {
    if (!term) return text;
    const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === term.toLowerCase()
        ? <mark key={i} className="cb-highlight">{part}</mark>
        : part
    );
  };

  const matchCount = searchTerm
    ? (block.output.match(new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    : 0;

  const timeFmt = block.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const outputLines = block.output ? block.output.split('\n').length : 0;

  return (
    <div
      className={`command-block ${isSelected ? 'cb-selected' : ''} ${block.isActive ? 'cb-active' : ''}`}
      onClick={() => onSelect(block.id)}
      data-theme={theme}
    >
      {/* Command header */}
      <div className="cb-header">
        <button
          className="cb-toggle"
          onClick={handleToggle}
          title={collapsed ? 'Expand output' : 'Collapse output'}
          aria-label={collapsed ? 'Expand output' : 'Collapse output'}
        >
          {collapsed ? '\u25B6' : '\u25BC'}
        </button>
        <span className="cb-prompt">$</span>
        <code className="cb-command">{block.command}</code>
        <span className="cb-meta">
          {block.workingDir && (
            <span className="cb-dir" title={block.workingDir}>
              {block.workingDir.split('/').pop() || block.workingDir}
            </span>
          )}
          <span className="cb-time">{timeFmt}</span>
          {block.exitCode !== undefined && block.exitCode !== 0 && (
            <span className="cb-exit-error" title={`Exit code: ${block.exitCode}`}>
              {block.exitCode}
            </span>
          )}
          {block.isActive && <span className="cb-running">running</span>}
        </span>
        <div className="cb-actions">
          {block.output && (
            <button
              className="cb-action-btn"
              onClick={handleSearchToggle}
              title="Search output"
              aria-label="Search output"
            >
              {'\u{1F50D}'}
            </button>
          )}
          <button
            className="cb-action-btn"
            onClick={handleCopy}
            title="Copy block"
            aria-label="Copy block"
          >
            {copied ? '\u2713' : '\u{1F4CB}'}
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="cb-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="cb-search-input"
            placeholder="Search output..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') {
                setShowSearch(false);
                setSearchTerm('');
              }
            }}
          />
          {searchTerm && (
            <span className="cb-search-count">
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </span>
          )}
        </div>
      )}

      {/* Output */}
      {block.output && !collapsed && (
        <pre ref={outputRef} className="cb-output">
          {searchTerm ? highlightOutput(block.output, searchTerm) : block.output}
        </pre>
      )}

      {/* Collapsed summary */}
      {block.output && collapsed && (
        <div className="cb-collapsed-summary">
          {outputLines} line{outputLines !== 1 ? 's' : ''} of output
        </div>
      )}
    </div>
  );
}
