import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';
import CommandBlockOverlay from './CommandBlockOverlay';
import AutocompleteDropdown from './AutocompleteDropdown';
import { getSuggestions, tokenize, type Suggestion } from '../autocomplete/AutocompleteEngine';

const DARK_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
  blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#333333',
  black: '#000000', red: '#cd3131', green: '#008000', yellow: '#795e26',
  blue: '#0451a5', magenta: '#af00db', cyan: '#0598bc', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00',
  brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
};

interface TerminalPaneProps {
  tabId: string;
  theme?: 'dark' | 'light';
  isVisible: boolean;
  onAskClaude: (question: string, context?: string) => void;
}

/** Debounce helper */
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  debounced.cancel = () => { if (timer) clearTimeout(timer); };
  return debounced;
}

export default function TerminalPane({ tabId, theme = 'dark', isVisible, onAskClaude: _onAskClaude }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);

  // Command Blocks state
  const [blocksEnabled, setBlocksEnabled] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [featureAllowed, setFeatureAllowed] = useState<boolean | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Smart Autocomplete state
  const [autocompleteAllowed, setAutocompleteAllowed] = useState(false);
  const [acSuggestions, setAcSuggestions] = useState<Suggestion[]>([]);
  const [acSelectedIndex, setAcSelectedIndex] = useState(0);
  const [acVisible, setAcVisible] = useState(false);
  const [acPosition, setAcPosition] = useState({ x: 0, y: 0 });

  // Refs for autocomplete state shared with the keyboard handler closure
  const inputBufferRef = useRef('');
  const acVisibleRef = useRef(false);
  const acSuggestionsRef = useRef<Suggestion[]>([]);
  const acSelectedIndexRef = useRef(0);
  const historyRef = useRef<string[]>([]);
  const cwdRef = useRef('');

  // Keep refs in sync with state
  useEffect(() => { acVisibleRef.current = acVisible; }, [acVisible]);
  useEffect(() => { acSuggestionsRef.current = acSuggestions; }, [acSuggestions]);
  useEffect(() => { acSelectedIndexRef.current = acSelectedIndex; }, [acSelectedIndex]);

  // Check feature flags on mount
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.licenseGetFeatures().then((features: Record<string, boolean>) => {
      if (!cancelled) {
        const blocksOk = features.commandBlocks === true;
        setFeatureAllowed(blocksOk);
        if (blocksOk) setBlocksEnabled(true);

        const acOk = features.smartAutocomplete === true;
        setAutocompleteAllowed(acOk);
      }
    }).catch(() => {
      if (!cancelled) {
        setFeatureAllowed(false);
        setAutocompleteAllowed(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Re-check features when auth/license changes
  useEffect(() => {
    const refreshFeatures = () => {
      window.electronAPI.licenseGetFeatures().then((features: Record<string, boolean>) => {
        const blocksOk = features.commandBlocks === true;
        setFeatureAllowed(blocksOk);
        if (blocksOk) setBlocksEnabled(true);
        setAutocompleteAllowed(features.smartAutocomplete === true);
      }).catch(() => {});
    };
    const cleanupAuth = window.electronAPI.onAuthStateChanged(refreshFeatures);
    const cleanupLicense = window.electronAPI.onLicenseUpdated(refreshFeatures);
    return () => { cleanupAuth(); cleanupLicense(); };
  }, []);

  // Load frequent commands on mount for autocomplete history
  useEffect(() => {
    if (!autocompleteAllowed) return;
    window.electronAPI.autocompleteFrequentCommands(30)
      .then(cmds => { historyRef.current = cmds; })
      .catch(() => {});
  }, [autocompleteAllowed]);

  const handleToggleBlocks = useCallback(() => {
    console.log('[Blocks] click — featureAllowed:', featureAllowed, 'blocksEnabled:', blocksEnabled, 'blocksOpen:', blocksOpen);
    if (featureAllowed) {
      setBlocksOpen(prev => {
        console.log('[Blocks] toggling to:', !prev);
        return !prev;
      });
    } else {
      setShowUpgrade(true);
    }
  }, [featureAllowed, blocksEnabled, blocksOpen]);

  // Refit terminal when blocks panel toggles
  useEffect(() => {
    if (fitAddonRef.current && isVisible) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (xtermRef.current) {
            window.electronAPI.ptyResize(tabId, xtermRef.current.cols, xtermRef.current.rows);
          }
        } catch {}
      }, 100);
    }
  }, [blocksOpen, isVisible, tabId]);

  // ── Autocomplete helpers ──────────────────────────────────────────

  /**
   * Compute the dropdown pixel position from the current cursor in the terminal.
   */
  const computeDropdownPosition = useCallback(() => {
    const terminal = xtermRef.current;
    const containerEl = terminalRef.current;
    if (!terminal || !containerEl) return { x: 20, y: 40 };

    // xterm exposes cursor position in buffer
    const cursorY = terminal.buffer.active.cursorY;
    const cursorX = terminal.buffer.active.cursorX;

    // Approximate cell size from terminal dimensions
    const termEl = containerEl.querySelector('.xterm-screen');
    if (!termEl) return { x: 20, y: 40 };

    const rect = termEl.getBoundingClientRect();
    const cellWidth = rect.width / terminal.cols;
    const cellHeight = rect.height / terminal.rows;

    // Position the dropdown just below the cursor line
    const x = Math.min(cursorX * cellWidth + 4, rect.width - 340);
    const y = (cursorY + 1) * cellHeight + 4;

    return { x: Math.max(0, x), y: Math.min(y, rect.height - 50) };
  }, []);

  /**
   * Update autocomplete suggestions based on the current input buffer.
   */
  const updateSuggestions = useCallback(async () => {
    if (!autocompleteAllowed) return;

    const input = inputBufferRef.current;

    // Fetch path completions if the current token looks like a path
    let pathCompletions: string[] = [];
    const { current } = tokenize(input);
    if (current.includes('/') || current.startsWith('~') || current.startsWith('.')) {
      try {
        pathCompletions = await window.electronAPI.autocompletePathComplete(
          current,
          cwdRef.current
        );
      } catch {}
    }

    // Refresh history for prefix matching
    const firstWord = input.split(/\s/)[0];
    if (firstWord && firstWord.length >= 1) {
      try {
        const histResults = await window.electronAPI.autocompleteSearchHistory(firstWord, 20);
        // Merge with existing frequent commands, dedup
        const seen = new Set(histResults);
        const merged = [...histResults];
        for (const h of historyRef.current) {
          if (!seen.has(h)) merged.push(h);
        }
        historyRef.current = merged.slice(0, 50);
      } catch {}
    }

    const suggestions = getSuggestions(input, {
      maxResults: 8,
      history: historyRef.current,
      pathCompletions,
    });

    if (suggestions.length > 0 && input.length > 0) {
      setAcSuggestions(suggestions);
      setAcSelectedIndex(0);
      setAcPosition(computeDropdownPosition());
      setAcVisible(true);
    } else {
      setAcVisible(false);
      setAcSuggestions([]);
    }
  }, [autocompleteAllowed, computeDropdownPosition]);

  // Debounced version of updateSuggestions
  const debouncedUpdateRef = useRef<((...args: any[]) => void) & { cancel: () => void } | null>(null);
  useEffect(() => {
    debouncedUpdateRef.current = debounce(updateSuggestions, 120);
    return () => { debouncedUpdateRef.current?.cancel(); };
  }, [updateSuggestions]);

  /**
   * Accept the currently selected suggestion.
   */
  const acceptSuggestion = useCallback((terminal: Terminal) => {
    const suggestions = acSuggestionsRef.current;
    const idx = acSelectedIndexRef.current;
    if (suggestions.length === 0 || idx >= suggestions.length) return;

    const suggestion = suggestions[idx];
    const currentInput = inputBufferRef.current;

    let newInput: string;
    if (suggestion.kind === 'history') {
      newInput = suggestion.text;
    } else {
      const { current } = tokenize(currentInput);
      let completion = suggestion.text;
      if (suggestion.kind === 'command' || suggestion.kind === 'subcommand' || suggestion.kind === 'flag') {
        completion += ' ';
      }
      const prefix = currentInput.slice(0, currentInput.length - current.length);
      newInput = prefix + completion;
    }

    // Kill current line (Ctrl+U) then type the completed input
    window.electronAPI.ptyWrite(tabId, '\x15' + newInput);
    inputBufferRef.current = newInput;

    // Dismiss dropdown
    setAcVisible(false);
    setAcSuggestions([]);
  }, [tabId]);

  // ── Terminal initialization ───────────────────────────────────────

  useEffect(() => {
    if (!terminalRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = '11';
    terminal.open(terminalRef.current);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 0);

    // Set up data handler
    const removeDataListener = window.electronAPI.onPtyData((_tabId: string, data: string) => {
      if (_tabId === tabId) {
        setIsLoading(false);
        terminal.write(data);

        // Detect cwd changes from shell prompt (look for common patterns)
        // This is a heuristic -- we look for OSC 7 sequences or common prompt patterns
        const osc7Match = data.match(/\x1b\]7;file:\/\/[^\/]*([^\x07\x1b]*)/);
        if (osc7Match) {
          cwdRef.current = decodeURIComponent(osc7Match[1]);
        }
      }
    });

    /**
     * Custom key event handler: intercepts keys when autocomplete is visible.
     * Return false to prevent xterm from processing the key,
     * return true to let xterm handle it normally.
     */
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      // Only intercept keydown events when autocomplete is visible
      if (event.type !== 'keydown' || !acVisibleRef.current) return true;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const max = acSuggestionsRef.current.length;
        setAcSelectedIndex(prev => (prev + 1) % max);
        return false;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const max = acSuggestionsRef.current.length;
        setAcSelectedIndex(prev => (prev - 1 + max) % max);
        return false;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        acceptSuggestion(terminal);
        return false;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setAcVisible(false);
        setAcSuggestions([]);
        return false;
      }

      if (event.key === 'Enter') {
        // Dismiss autocomplete and let enter pass through
        setAcVisible(false);
        setAcSuggestions([]);
        inputBufferRef.current = '';
        return true;
      }

      return true;
    });

    // Track terminal input for autocomplete
    terminal.onData((data) => {
      window.electronAPI.ptyWrite(tabId, data);

      // Update input buffer for autocomplete
      if (data === '\r' || data === '\n') {
        // Enter: reset input buffer
        inputBufferRef.current = '';
        setAcVisible(false);
        setAcSuggestions([]);
      } else if (data === '\x7F' || data === '\b') {
        // Backspace: remove last character
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        if (inputBufferRef.current.length === 0) {
          setAcVisible(false);
          setAcSuggestions([]);
        } else {
          debouncedUpdateRef.current?.();
        }
      } else if (data === '\x03') {
        // Ctrl+C: reset
        inputBufferRef.current = '';
        setAcVisible(false);
        setAcSuggestions([]);
      } else if (data === '\x15') {
        // Ctrl+U: clear line
        inputBufferRef.current = '';
        setAcVisible(false);
        setAcSuggestions([]);
      } else if (data === '\x17') {
        // Ctrl+W: delete word backward
        const trimmed = inputBufferRef.current.trimEnd();
        const lastSpace = trimmed.lastIndexOf(' ');
        inputBufferRef.current = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : '';
        if (inputBufferRef.current.length === 0) {
          setAcVisible(false);
        } else {
          debouncedUpdateRef.current?.();
        }
      } else if (data.length === 1 && data >= ' ') {
        // Printable character
        inputBufferRef.current += data;
        debouncedUpdateRef.current?.();
      } else if (data === '\x1b[A' || data === '\x1b[B') {
        // Up/Down arrows (shell history navigation): reset our buffer
        // These only fire when autocomplete is NOT visible (since we intercept them above)
        inputBufferRef.current = '';
        setAcVisible(false);
        setAcSuggestions([]);
      } else if (data.startsWith('\x1b')) {
        // Other escape sequences (arrow keys, etc): dismiss autocomplete
        setAcVisible(false);
        setAcSuggestions([]);
        inputBufferRef.current = '';
      }
    });

    window.electronAPI.ptyStart(tabId);

    const handleResize = () => {
      if (isVisible) {
        try {
          fitAddon.fit();
          window.electronAPI.ptyResize(tabId, terminal.cols, terminal.rows);
        } catch {}
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      removeDataListener();
      terminal.dispose();
      window.electronAPI.ptyKill(tabId);
      initializedRef.current = false;
    };
  }, [tabId, acceptSuggestion]);

  // Refit when tab becomes visible
  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      }, 50);
    }
  }, [isVisible]);

  // Update theme
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
    }
  }, [theme]);

  return (
    <div className="pane terminal-pane" style={{ display: isVisible ? 'flex' : 'none' }}>
      {isLoading && (
        <div className="terminal-loading">
          <div className="terminal-loading-spinner" />
          <span>Starting terminal...</span>
        </div>
      )}

      {/* Command Blocks toggle button */}
      <button
        className={`cb-toggle-btn ${blocksOpen ? 'cb-active' : ''}`}
        onClick={handleToggleBlocks}
        title="Toggle Command Blocks (v1.1)"
      >
        <svg className="cb-toggle-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Blocks
      </button>

      <div className="terminal-pane-inner" style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div
          className="pane-content"
          ref={terminalRef}
          style={{
            opacity: isLoading ? 0 : 1,
            flex: 1,
            minWidth: 0,
            position: 'relative',
          }}
        >
          {/* Smart Autocomplete dropdown — positioned inside terminal content area */}
          {autocompleteAllowed && (
            <AutocompleteDropdown
              suggestions={acSuggestions}
              selectedIndex={acSelectedIndex}
              position={acPosition}
              visible={acVisible}
              theme={theme}
            />
          )}
        </div>

        {/* Command Blocks overlay panel */}
        {blocksEnabled && (
          <CommandBlockOverlay
            tabId={tabId}
            theme={theme}
            isVisible={isVisible && blocksOpen}
          />
        )}

        {/* Upgrade prompt for non-licensed users */}
        {showUpgrade && !featureAllowed && (
          <div className="cb-upgrade-prompt" data-theme={theme}>
            <div className="cb-upgrade-icon">{'\u2593'}</div>
            <div className="cb-upgrade-title">Command Blocks</div>
            <div className="cb-upgrade-desc">
              Group terminal output into visual blocks for easy navigation, copying, and search.
              Available on Basic and Pro plans.
            </div>
            <button
              className="cb-upgrade-btn"
              onClick={() => {
                setShowUpgrade(false);
                window.electronAPI.authOpenPricing();
              }}
            >
              View Plans
            </button>
            <button
              className="cb-upgrade-dismiss"
              onClick={() => setShowUpgrade(false)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
