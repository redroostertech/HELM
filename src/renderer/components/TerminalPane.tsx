import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';

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

export default function TerminalPane({ tabId, theme = 'dark', isVisible, onAskClaude }: TerminalPaneProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!terminalRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 0);

    // Set up data handler and store cleanup
    const removeDataListener = window.electronAPI.onPtyData((_tabId: string, data: string) => {
      if (_tabId === tabId) {
        terminal.write(data);
      }
    });

    terminal.onData((data) => {
      window.electronAPI.ptyWrite(tabId, data);
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
  }, [tabId]);

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
      <div className="pane-content" ref={terminalRef} />
    </div>
  );
}
