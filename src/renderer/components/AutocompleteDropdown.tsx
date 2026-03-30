import { useEffect, useRef } from 'react';
import type { Suggestion } from '../autocomplete/AutocompleteEngine';
import './AutocompleteDropdown.css';

interface AutocompleteDropdownProps {
  suggestions: Suggestion[];
  selectedIndex: number;
  /** Pixel position relative to the terminal container */
  position: { x: number; y: number };
  visible: boolean;
  theme: 'dark' | 'light';
}

const KIND_ICONS: Record<string, string> = {
  command: '\u25B6',    // right-pointing triangle
  subcommand: '\u25B7', // white right-pointing triangle
  flag: '\u2691',       // flag
  history: '\u29D6',    // clock-like
  path: '\u2302',       // house / folder
};

const KIND_COLORS: Record<string, string> = {
  command: '#569cd6',
  subcommand: '#4ec9b0',
  flag: '#ce9178',
  history: '#888',
  path: '#dcdcaa',
};

export default function AutocompleteDropdown({
  suggestions,
  selectedIndex,
  position,
  visible,
  theme,
}: AutocompleteDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!visible || suggestions.length === 0) return null;

  return (
    <div
      className={`autocomplete-dropdown ${theme}`}
      style={{
        left: position.x,
        top: position.y,
      }}
      ref={listRef}
    >
      {suggestions.map((suggestion, i) => {
        const isSelected = i === selectedIndex;
        return (
          <div
            key={`${suggestion.kind}-${suggestion.text}-${i}`}
            ref={isSelected ? selectedRef : undefined}
            className={`autocomplete-item ${isSelected ? 'selected' : ''}`}
          >
            <span
              className="autocomplete-icon"
              style={{ color: KIND_COLORS[suggestion.kind] || '#888' }}
            >
              {KIND_ICONS[suggestion.kind] || '\u25CF'}
            </span>
            <span className="autocomplete-label">
              {suggestion.label}
            </span>
            {suggestion.description && (
              <span className="autocomplete-desc">
                {suggestion.description}
              </span>
            )}
            {isSelected && (
              <span className="autocomplete-hint">
                Tab
              </span>
            )}
          </div>
        );
      })}
      <div className="autocomplete-footer">
        <span>\u2191\u2193 navigate</span>
        <span>Tab accept</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}
