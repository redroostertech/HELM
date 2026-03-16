import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import './ChatPane.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

interface ChatPaneProps {
  isOpen: boolean;
  activeTabId: string;
  theme: string;
}

function parseContent(text: string): { type: 'text' | 'code'; value: string; lang?: string }[] {
  const parts: { type: 'text' | 'code'; value: string; lang?: string }[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', value: match[2].replace(/\n$/, ''), lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts;
}

function CodeBlock({ code, lang, onRun }: { code: string; lang?: string; onRun: (cmd: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isRunnable = !lang || ['bash', 'sh', 'zsh', 'shell', 'console', 'terminal'].includes(lang.toLowerCase());

  return (
    <div className="chat-code-block">
      {lang && <span className="chat-code-lang">{lang}</span>}
      <pre><code>{code}</code></pre>
      <div className="chat-code-actions">
        <button className="chat-code-btn" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {isRunnable && (
          <button className="chat-code-btn chat-code-run" onClick={() => onRun(code)}>
            Run
          </button>
        )}
      </div>
    </div>
  );
}

let convCounter = 0;
function createConversation(): Conversation {
  return {
    id: `conv-${++convCounter}`,
    title: 'New Chat',
    messages: [],
    createdAt: new Date(),
  };
}

function generateTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content;
  return text.length > 40 ? text.slice(0, 40) + '...' : text;
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function loadConversations(): Conversation[] {
  try {
    const saved = localStorage.getItem('helm-chats');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.length > 0) {
        return parsed.map((c: any) => ({ ...c, createdAt: new Date(c.createdAt) }));
      }
    }
  } catch {}
  return [createConversation()];
}

function saveConversations(convs: Conversation[]) {
  localStorage.setItem('helm-chats', JSON.stringify(convs));
}

export default function ChatPane({ isOpen, activeTabId, theme }: ChatPaneProps) {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeConvId, setActiveConvId] = useState(conversations[0].id);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find(c => c.id === activeConvId) || conversations[0];
  const messages = activeConv?.messages || [];

  // Persist chats
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  useEffect(() => {
    if (isOpen && !showHistory) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, showHistory]);

  const runCommand = useCallback(
    (cmd: string) => {
      const lines = cmd.split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
        window.electronAPI.ptyWrite(activeTabId, line + '\r');
      }
    },
    [activeTabId],
  );

  const updateConversation = (convId: string, newMessages: ChatMessage[]) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const title = c.title === 'New Chat' ? generateTitle(newMessages) : c.title;
      return { ...c, messages: newMessages, title };
    }));
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const updated = [...messages, userMsg];
    updateConversation(activeConvId, updated);
    setInput('');
    setIsLoading(true);

    try {
      const recentContext = updated
        .slice(-6)
        .map(m => `${m.role}: ${m.content}`)
        .join('\n');
      const response = await window.electronAPI.aiAsk(trimmed, recentContext || undefined);
      const assistantMsg: ChatMessage = { role: 'assistant', content: response };
      updateConversation(activeConvId, [...updated, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I could not get a response. Check your API key in Settings.',
      };
      updateConversation(activeConvId, [...updated, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    const conv = createConversation();
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setShowHistory(false);
  };

  const handleSelectConversation = (id: string) => {
    setActiveConvId(id);
    setShowHistory(false);
  };

  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (conversations.length <= 1) {
      // Reset the only conversation
      const conv = createConversation();
      setConversations([conv]);
      setActiveConvId(conv.id);
      return;
    }
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConvId === id) {
      const remaining = conversations.filter(c => c.id !== id);
      setActiveConvId(remaining[0]?.id || '');
    }
  };

  if (!isOpen) return null;

  // History view
  if (showHistory) {
    return (
      <div className="chat-pane">
        <div className="chat-pane-header">
          <button className="chat-header-btn" onClick={() => setShowHistory(false)} title="Back to chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span>Chat History</span>
          <button className="chat-header-btn" onClick={handleNewChat} title="New chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
        <div className="chat-history-list">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`chat-history-item ${conv.id === activeConvId ? 'active' : ''}`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              <div className="chat-history-item-content">
                <span className="chat-history-title">{conv.title}</span>
                <span className="chat-history-meta">
                  {conv.messages.length} messages &middot; {formatTime(conv.createdAt)}
                </span>
              </div>
              <button
                className="chat-history-delete"
                onClick={e => handleDeleteConversation(conv.id, e)}
                title="Delete"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Chat view
  return (
    <div className="chat-pane">
      <div className="chat-pane-header">
        <button className="chat-header-btn" onClick={() => setShowHistory(true)} title="Chat history">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </button>
        <span className="chat-header-title">{activeConv.title}</span>
        <button className="chat-header-btn" onClick={handleNewChat} title="New chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty-state">
            <p>Ask a question about your terminal, commands, or code.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
            {msg.role === 'assistant' ? (
              <div className="chat-bubble-content chat-markdown">
                <ReactMarkdown
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const codeStr = String(children).replace(/\n$/, '');
                      if (match || (codeStr.includes('\n') && !className)) {
                        return <CodeBlock code={codeStr} lang={match?.[1]} onRun={runCommand} />;
                      }
                      return <code className="chat-inline-code" {...props}>{children}</code>;
                    },
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="chat-bubble-content">
                <span className="chat-text">{msg.content}</span>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="chat-bubble chat-bubble-assistant">
            <div className="chat-loading">
              <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Ask something..."
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            title="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
