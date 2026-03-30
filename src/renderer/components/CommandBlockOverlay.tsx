import { useState, useEffect, useRef, useCallback } from 'react';
import CommandBlock, { CommandBlockData } from './CommandBlock';
import './CommandBlockOverlay.css';

/**
 * Strips ANSI escape sequences from terminal output.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/**
 * Heuristic: detect if a line looks like a shell prompt.
 * Matches patterns like "user@host:~$", "user@host %", "~ ❯", "➜  dir"
 */
function isPromptLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Common prompt endings
  const promptEndings = /[$%#❯➜>]\s*$/;
  // user@host pattern
  const userHostPattern = /\w+@[\w.-]+/;
  // Simple directory + prompt char
  const dirPrompt = /^[~\/].*[$%#❯➜>]\s*$/;

  if (userHostPattern.test(trimmed) && promptEndings.test(trimmed)) return true;
  if (dirPrompt.test(trimmed)) return true;

  return false;
}

/**
 * Extract the command typed at a prompt line.
 * Prompt text is everything up to and including the prompt char; command is the rest.
 */
function extractCommand(line: string): string {
  // Find the last prompt character and take everything after it
  const match = line.match(/[$%#❯➜>]\s*(.+)$/);
  return match ? match[1].trim() : line.trim();
}

interface CommandBlockOverlayProps {
  tabId: string;
  theme: 'dark' | 'light';
  isVisible: boolean;
}

let blockIdCounter = 0;
function nextBlockId(): string {
  blockIdCounter++;
  return `block-${Date.now()}-${blockIdCounter}`;
}

export default function CommandBlockOverlay({ tabId, theme, isVisible }: CommandBlockOverlayProps) {
  const [blocks, setBlocks] = useState<CommandBlockData[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parsing state refs (survive re-renders)
  const parserRef = useRef({
    buffer: '',
    currentBlockId: null as string | null,
    seenFirstPrompt: false,
  });

  const handlePtyData = useCallback((_tabId: string, data: string) => {
    if (_tabId !== tabId) return;

    const parser = parserRef.current;
    parser.buffer += data;

    // Process complete lines (keep partial line in buffer)
    const lines = parser.buffer.split('\n');
    // The last element is the incomplete line; keep it in the buffer
    parser.buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const clean = stripAnsi(rawLine).replace(/\r/g, '');

      // Skip empty lines in block detection
      if (!clean.trim()) {
        // Append to current block output if one exists
        if (parser.currentBlockId) {
          setBlocks(prev => prev.map(b =>
            b.id === parser.currentBlockId
              ? { ...b, output: b.output + '\n' }
              : b
          ));
        }
        continue;
      }

      if (isPromptLine(clean)) {
        // Close previous active block
        if (parser.currentBlockId) {
          setBlocks(prev => prev.map(b =>
            b.id === parser.currentBlockId
              ? { ...b, isActive: false }
              : b
          ));
        }

        // Detect command from the prompt line
        const command = extractCommand(clean);
        if (command && parser.seenFirstPrompt) {
          const id = nextBlockId();
          parser.currentBlockId = id;
          setBlocks(prev => [...prev, {
            id,
            command,
            output: '',
            timestamp: new Date(),
            isActive: true,
          }]);
        } else {
          // First prompt — no command yet, just mark seen
          parser.seenFirstPrompt = true;
          parser.currentBlockId = null;
        }
      } else {
        // Output line — append to current block
        if (parser.currentBlockId) {
          setBlocks(prev => prev.map(b =>
            b.id === parser.currentBlockId
              ? { ...b, output: b.output ? b.output + '\n' + clean : clean }
              : b
          ));
        }
      }
    }

    // Also check if the remaining buffer (partial line) looks like a prompt
    // This handles the case where a prompt is emitted without a trailing newline
    const partialClean = stripAnsi(parser.buffer).replace(/\r/g, '');
    if (partialClean && isPromptLine(partialClean)) {
      // Close previous active block
      if (parser.currentBlockId) {
        setBlocks(prev => prev.map(b =>
          b.id === parser.currentBlockId
            ? { ...b, isActive: false }
            : b
        ));
      }

      const command = extractCommand(partialClean);
      if (command && parser.seenFirstPrompt) {
        const id = nextBlockId();
        parser.currentBlockId = id;
        setBlocks(prev => [...prev, {
          id,
          command,
          output: '',
          timestamp: new Date(),
          isActive: true,
        }]);
      } else {
        parser.seenFirstPrompt = true;
        parser.currentBlockId = null;
      }
      parser.buffer = '';
    }
  }, [tabId]);

  // Subscribe to PTY data
  useEffect(() => {
    const cleanup = window.electronAPI.onPtyData(handlePtyData);
    return cleanup;
  }, [handlePtyData]);

  // Clear blocks when tab changes or on history clear
  useEffect(() => {
    const handleClear = () => {
      setBlocks([]);
      parserRef.current = { buffer: '', currentBlockId: null, seenFirstPrompt: false };
    };
    window.addEventListener('history-cleared', handleClear);
    return () => window.removeEventListener('history-cleared', handleClear);
  }, []);

  // Keyboard navigation: Cmd+Up / Cmd+Down to move between blocks
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setBlocks(currentBlocks => {
          if (currentBlocks.length === 0) return currentBlocks;

          setSelectedBlockId(prevId => {
            const currentIdx = prevId ? currentBlocks.findIndex(b => b.id === prevId) : -1;
            let nextIdx: number;

            if (e.key === 'ArrowUp') {
              nextIdx = currentIdx <= 0 ? currentBlocks.length - 1 : currentIdx - 1;
            } else {
              nextIdx = currentIdx >= currentBlocks.length - 1 ? 0 : currentIdx + 1;
            }

            const nextId = currentBlocks[nextIdx].id;

            // Scroll to the selected block
            requestAnimationFrame(() => {
              const el = containerRef.current?.querySelector(`[data-block-id="${nextId}"]`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });

            return nextId;
          });

          return currentBlocks;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible]);

  // Auto-scroll to latest block
  useEffect(() => {
    if (blocks.length > 0 && containerRef.current) {
      const last = containerRef.current.lastElementChild;
      last?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [blocks.length]);

  if (!isVisible || blocks.length === 0) return null;

  return (
    <div className="cb-overlay" ref={containerRef} data-theme={theme}>
      <div className="cb-overlay-header">
        <span className="cb-overlay-title">Command Blocks</span>
        <span className="cb-overlay-count">{blocks.length} block{blocks.length !== 1 ? 's' : ''}</span>
        <span className="cb-overlay-hint">Cmd+Up/Down to navigate</span>
      </div>
      <div className="cb-overlay-list">
        {blocks.map(block => (
          <div key={block.id} data-block-id={block.id}>
            <CommandBlock
              block={block}
              isSelected={block.id === selectedBlockId}
              onSelect={setSelectedBlockId}
              theme={theme}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
