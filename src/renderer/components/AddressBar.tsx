import { useState, useEffect, useRef } from 'react';
import './AddressBar.css';

interface AddressBarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

export default function AddressBar({ currentPath, onNavigate }: AddressBarProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!input && currentPath) {
      setInput(currentPath);
    }
  }, [currentPath]);

  useEffect(() => {
    if (!input || input.length < 2) {
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const dirs = await window.electronAPI.fsListDirs(input);
        setSuggestions(dirs);
        setShowSuggestions(dirs.length > 0);
      } catch {
        setShowSuggestions(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(input);
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (suggestions[selectedIndex]) {
        e.preventDefault();
        setInput(suggestions[selectedIndex]);
        setShowSuggestions(false);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="address-bar-container">
      <form className="address-bar" onSubmit={handleSubmit}>
        <div className="address-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="address-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type directory path (e.g. ~/Documents/projects)"
          autoFocus
        />

        <button type="submit" className="go-button">
          Go
        </button>
      </form>

      {showSuggestions && (
        <div className="suggestions-dropdown">
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion}
              className={`suggestion-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                setInput(suggestion);
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
