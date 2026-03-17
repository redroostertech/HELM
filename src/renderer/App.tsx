import { useState, useEffect, useCallback } from 'react';
import './App.css';
import AddressBar from './components/AddressBar';
import TabBar, { TerminalTab } from './components/TabBar';
import TerminalPane from './components/TerminalPane';
import ExplainPane from './components/ExplainPane';
import HistoryPane from './components/HistoryPane';
import SettingsPanel from './components/SettingsPanel';
import ConfirmModal from './components/ConfirmModal';
import ChatPane from './components/ChatPane';
import SessionsPane from './components/SessionsPane';

const DEFAULT_SETTINGS = {
  theme: 'dark' as const,
  aiProvider: 'openai' as const,
  openaiApiKey: '',
  anthropicApiKey: '',
  openaiModel: 'gpt-4o',
  anthropicModel: 'claude-sonnet-4-20250514',
};

let tabCounter = 0;

function createTab(): TerminalTab {
  tabCounter++;
  const id = `tab-${Date.now()}-${tabCounter}`;
  return { id, label: `Terminal ${tabCounter}`, description: '', memoryMB: 0 };
}

function loadTabs(): { tabs: TerminalTab[]; activeId: string } {
  try {
    const saved = localStorage.getItem('helm-tabs');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.tabs?.length > 0) {
        // Generate fresh IDs so PTY connections are clean on restart
        tabCounter = 0;
        const tabs = parsed.tabs.map((t: any) => {
          tabCounter++;
          return {
            ...t,
            id: `tab-${Date.now()}-${tabCounter}`,
            memoryMB: 0,
            description: '',
          };
        });
        return { tabs, activeId: tabs[0].id };
      }
    }
  } catch {}
  const tab = createTab();
  return { tabs: [tab], activeId: tab.id };
}

function saveTabs(tabs: TerminalTab[], activeId: string) {
  localStorage.setItem('helm-tabs', JSON.stringify({
    tabs: tabs.map(t => ({ id: t.id, label: t.label, description: '', memoryMB: 0 })),
    activeId,
  }));
}

function App() {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => loadTabs().tabs);
  const [activeTabId, setActiveTabId] = useState(() => loadTabs().activeId);
  const [currentPath, setCurrentPath] = useState('~');
  const [selectedCommand, setSelectedCommand] = useState<any>(null);
  const [explanation, setExplanation] = useState<any>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [showExplainPane, setShowExplainPane] = useState(false);
  const [showHistoryPane, setShowHistoryPane] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCloseTabConfirm, setShowCloseTabConfirm] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const [authState, setAuthState] = useState<{
    isAuthenticated: boolean;
    email: string | null;
    userName: string | null;
    tier: string;
  }>({ isAuthenticated: false, email: null, userName: null, tier: 'free' });

  // AI features require authentication
  const isAuthenticated = authState.isAuthenticated;

  // Persist tabs
  useEffect(() => {
    saveTabs(tabs, activeTabId);
  }, [tabs, activeTabId]);

  // Refit terminal when panels toggle
  useEffect(() => {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }, [chatOpen, sidebarOpen, sessionsOpen]);

  useEffect(() => {
    window.electronAPI.settingsLoad().then((saved: any) => {
      if (saved) {
        setSettings(saved);
        document.documentElement.setAttribute('data-theme', saved.theme || 'dark');
      }
    }).catch(() => {});

    window.electronAPI.licenseGetUsage().then(setUsage).catch(() => {});

    // Load auth state
    window.electronAPI.authGetState().then(setAuthState).catch(() => {});

    // Listen for auth state changes (e.g. from login callback, focus sync)
    const cleanupAuth = window.electronAPI.onAuthStateChanged((state: any) => {
      setAuthState(state);
      window.electronAPI.licenseGetUsage().then(setUsage).catch(() => {});
    });

    // Listen for license/subscription updates (background sync, focus sync)
    const cleanupLicense = window.electronAPI.onLicenseUpdated((newUsage: any) => {
      setUsage(newUsage);
    });

    // Listen for delete history event from settings
    const handler = () => setShowDeleteConfirm(true);
    window.addEventListener('show-delete-history-modal', handler);
    return () => {
      window.removeEventListener('show-delete-history-modal', handler);
      cleanupAuth();
      cleanupLicense();
    };
  }, []);

  // Update tab descriptions and memory periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const memUsage = await window.electronAPI.ptyMemoryUsage();
        setTabs(prev => prev.map(tab => {
          const mem = memUsage[tab.id] || 0;
          return { ...tab, memoryMB: mem };
        }));

        // Update descriptions from recent commands
        for (const tab of tabs) {
          try {
            const cmds = await window.electronAPI.ptyRecentCommands(tab.id);
            if (cmds.length > 0) {
              const desc = cmds.slice(-2).join(' > ');
              setTabs(prev => prev.map(t =>
                t.id === tab.id ? { ...t, description: desc } : t
              ));
            }
          } catch {}
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [tabs.length]);

  const handleSettingsChange = async (newSettings: typeof DEFAULT_SETTINGS) => {
    setSettings(newSettings);
    document.documentElement.setAttribute('data-theme', newSettings.theme);
    await window.electronAPI.settingsSave(newSettings);
  };

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    window.electronAPI.ptyWrite(activeTabId, `cd ${path}\r`);
  };

  const handleCommandSelect = async (command: any) => {
    setSelectedCommand(command);
    setShowExplainPane(true);
    setShowHistoryPane(false);

    if (command) {
      // Check for cached explanation first
      try {
        const cached = await window.electronAPI.dbGetExplanation(command.input);
        if (cached) {
          setExplanation(cached);
          return;
        }
      } catch {}

      // Fetch from AI
      setIsExplaining(true);
      try {
        const exp = await window.electronAPI.aiExplain(command.input);
        setExplanation(exp);
        if (command.id) {
          try { await window.electronAPI.dbSaveExplanation(command.id, exp); } catch {}
        }
      } catch {
        setExplanation({
          summary: 'Failed to get explanation. Check your API key in Settings.',
          breakdown: [], expectedOutcome: 'Error', failureModes: [], undoGuidance: null,
        });
      } finally {
        setIsExplaining(false);
      }
    }
  };

  const handleAsk = async (_question: string, _context?: string) => {
    // Open chat pane when user asks a question from the address bar
    setChatOpen(true);
  };

  const handleNewTab = () => {
    if (tabs.length >= 7) return;
    const tab = createTab();
    setTabs(prev => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const handleCloseTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    setShowCloseTabConfirm(tabId);
  };

  const confirmCloseTab = () => {
    const tabId = showCloseTabConfirm;
    if (!tabId) return;
    setShowCloseTabConfirm(null);

    const idx = tabs.findIndex(t => t.id === tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));

    if (activeTabId === tabId) {
      const newIdx = Math.min(idx, tabs.length - 2);
      const remaining = tabs.filter(t => t.id !== tabId);
      setActiveTabId(remaining[Math.max(0, newIdx)]?.id || '');
    }
  };

  const handleRenameTab = (tabId: string, label: string) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, label } : t));
  };

  const handleDeleteHistory = async () => {
    await window.electronAPI.dbClearHistory();
    setShowDeleteConfirm(false);
    setSelectedCommand(null);
    setExplanation(null);
    // Notify all panes to refresh
    window.dispatchEvent(new Event('history-cleared'));
  };

  return (
    <div className="app" data-theme={settings.theme}>
      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onRenameTab={handleRenameTab}
        onSettingsClick={() => setSettingsOpen(true)}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(!chatOpen)}
        sessionsOpen={sessionsOpen}
        onToggleSessions={() => setSessionsOpen(!sessionsOpen)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Address bar */}
      <AddressBar
        currentPath={currentPath}
        onNavigate={handleNavigate}
      />

      {/* Main content */}
      <div className="main-content">
        {/* Chat pane (left side) — hidden when not authenticated */}
        <ChatPane
          isOpen={chatOpen}
          activeTabId={activeTabId}
          theme={settings.theme}
          isPro={isAuthenticated}
          onUpgrade={() => { setChatOpen(false); setSettingsOpen(true); }}
        />
        <div className="terminal-container">
          {tabs.map(tab => (
            <TerminalPane
              key={tab.id}
              tabId={tab.id}
              theme={settings.theme}
              isVisible={tab.id === activeTabId}
              onAskClaude={handleAsk}
            />
          ))}
        </div>

        <SessionsPane
          isOpen={sessionsOpen}
          activeTabId={activeTabId}
        />

        {sidebarOpen && (
          <div className="sidebar">
            <div className="sidebar-tabs">
              <button
                className={showHistoryPane ? 'active' : ''}
                onClick={() => { setShowHistoryPane(true); setShowExplainPane(false); }}
              >
                History
              </button>
              <button
                className={showExplainPane ? 'active' : ''}
                onClick={() => { setShowExplainPane(true); setShowHistoryPane(false); }}
              >
                Explain
              </button>
            </div>
            <div className="sidebar-content">
              {showHistoryPane && (
                <HistoryPane onCommandSelect={handleCommandSelect} selectedCommandId={selectedCommand?.id} />
              )}
              {showExplainPane && (
                <ExplainPane
                  explanation={explanation}
                  isLoading={isExplaining}
                  selectedCommand={selectedCommand}
                  isPro={isAuthenticated}
                  onUpgrade={() => setSettingsOpen(true)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Settings */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={handleSettingsChange}
        currentSettings={settings}
        authState={authState}
        onAuthStateChange={(state) => {
          setAuthState(state);
          window.electronAPI.licenseGetUsage().then(setUsage).catch(() => {});
        }}
      />

      {/* Delete history confirmation */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Clear Command History"
        message="This will permanently delete all command history, bookmarks, and lessons. This cannot be undone."
        confirmLabel="Delete All"
        danger
        onConfirm={handleDeleteHistory}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Close tab confirmation */}
      <ConfirmModal
        isOpen={!!showCloseTabConfirm}
        title="Close Terminal"
        message="This will terminate the shell session in this tab. Any running processes will be stopped."
        confirmLabel="Close Tab"
        danger
        onConfirm={confirmCloseTab}
        onCancel={() => setShowCloseTabConfirm(null)}
      />
    </div>
  );
}

export default App;
