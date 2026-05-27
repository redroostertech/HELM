import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import * as dotenv from 'dotenv';

// Load .env from project root (dev) or app resources (production)
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(process.resourcesPath || '', '.env') });

const SETTINGS_PATH = path.join(os.homedir(), '.helm-settings.json');

function loadSettings(): any {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
  } catch {}
  return {
    theme: 'dark',
    aiProvider: 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    openaiModel: 'gpt-4o',
    anthropicModel: 'claude-sonnet-4-20250514',
  };
}

function saveSettings(settings: any): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
import { PTYManager } from './pty-manager';
import { DatabaseManager } from './database';
import { AIService } from './ai-service';
import { OpenAIService } from './openai-service';
import { AnthropicService } from './anthropic-service';
import { HelmAPI } from './helm-api';
import { LicenseManager } from './licensing';
import { MobileAccessServer } from './mobile-server';
import { HelmIPCServer, PendingTabContext, TabInfo } from './helm-ipc-server';
import { installCLI } from './cli-install';
import { CruiseOrchestrator } from './cruise/orchestrator';
import type { CruiseRunConfig } from './database';

// Register custom protocol for deep linking (helm://)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('helm', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('helm');
}

let mainWindow: BrowserWindow | null = null;
let ptyManager: PTYManager | null = null;
let db: DatabaseManager | null = null;
let aiService: AIService | null = null;
let licenseManager: LicenseManager | null = null;
let mobileServer: MobileAccessServer | null = null;
let helmIPCServer: HelmIPCServer | null = null;
let cruiseOrchestrator: CruiseOrchestrator | null = null;
let lastReportedTabs: TabInfo[] = [];
// Pending tab-list requests keyed by requestId, awaiting renderer response
const pendingTabRequests: Map<string, (tabs: TabInfo[]) => void> = new Map();

// Forge API configuration — all AI requests route through Forge
const FORGE_API_KEY = 'rrt-burst-3f24900af81b04ba915d3fda37df147bf297d5e12444dee1a87f54fabec13e6a';
const FORGE_BASE_URL = 'https://forge-api.lanaai.io/v1';

function createAIService(settings?: any): AIService {
  const s = settings || loadSettings();
  const tier = licenseManager?.getTier() || 'free';

  // BYOK users — call their selected provider directly with their own key
  if (tier === 'byok') {
    if (s.aiProvider === 'anthropic' && s.anthropicApiKey) {
      console.log('🧠 Using Anthropic (Claude) API — user key (BYOK)');
      return new AnthropicService(s.anthropicApiKey, s.anthropicModel);
    }
    if (s.aiProvider === 'openai' && s.openaiApiKey) {
      console.log('🧠 Using OpenAI API — user key (BYOK)');
      return new OpenAIService(s.openaiApiKey, s.openaiModel);
    }
    // BYOK user hasn't configured a key yet — fall through to Forge
    console.warn('🧠 BYOK user has no API key configured — falling back to Forge');
  }

  // All other tiers (Free/Basic/Pro) — route through Forge gateway
  console.log(`🧠 Using Forge AI gateway — HELM ${tier} tier (forge-api.lanaai.io)`);
  return new OpenAIService(FORGE_API_KEY, 'auto', FORGE_BASE_URL);
}

/** Sync license/subscription state with the backend and notify the renderer */
async function syncWithBackend(): Promise<boolean> {
  if (!licenseManager || !licenseManager.isAuthenticated()) return false;
  try {
    const valid = await licenseManager.validateSession();
    if (valid) {
      aiService = createAIService();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:stateChanged', licenseManager.getAuthState());
      mainWindow.webContents.send('license:updated', licenseManager.getUsageSummary());
    }
    return valid;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for node-pty
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Development mode
  if (!app.isPackaged) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Keyboard shortcut to toggle DevTools (Cmd+Option+I / Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'i' &&
        ((input.meta && input.alt) || (input.control && input.shift))) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // Initialize services
  db = new DatabaseManager();
  // Close any sessions left open from a previous run
  db.closeOrphanedSessions().catch(() => {});
  ptyManager = new PTYManager(db);
  licenseManager = new LicenseManager();
  aiService = createAIService();
  mobileServer = new MobileAccessServer();

  // Forward CLI start/stop events to mobile clients
  ptyManager.onCLIStatus((tabId, active, programName) => {
    if (mobileServer) {
      mobileServer.broadcastCLIStatus(tabId, active, programName);
    }
  });

  // Forward captured commands to renderer (Command Blocks)
  ptyManager.onCommandCaptured((tabId, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:command-captured', tabId, command);
    }
  });

  // Forward CLI conversation events (Claude responses) to mobile clients
  ptyManager.cliWatcher.onEvent((event) => {
    if (!mobileServer) return;
    const tabId = ptyManager!.getTabForCLISession(event.cliSessionId);
    if (tabId) {
      console.log(`📱 CLI event → mobile: ${event.type} (${event.content.slice(0, 60)}...)`);
      mobileServer.broadcastCLIEvent(tabId, { type: event.type, content: event.content });
    }
  });

  // Start the HELM CLI IPC server (listens on a Unix socket for the `helm` shim)
  helmIPCServer = new HelmIPCServer({
    reserveTab: (ctx: PendingTabContext, _label?: string) => {
      const tabId = `cli-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ptyManager?.setPendingContext(tabId, ctx);
      return tabId;
    },
    getTabs: () => requestTabsFromRenderer(),
    focusWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    notifyRendererNewTab: (tabId: string, label: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('helm:new-tab', { tabId, label });
      }
    },
    getVersionInfo: () => readVersionInfo(),
    cruise: {
      start: async (config: any) => {
        if (!cruiseOrchestrator) throw new Error('cruise orchestrator not initialized');
        return cruiseOrchestrator.start(config);
      },
      status: async (runId: number | null) => {
        if (!cruiseOrchestrator) return { run: null };
        if (runId == null) {
          const list = await cruiseOrchestrator.listRuns();
          const active = list.find(r => r.status === 'running' || r.status === 'paused');
          if (!active) return { run: null };
          runId = active.id;
        }
        const result = await cruiseOrchestrator.getRun(runId);
        return result || { run: null };
      },
      list: async () => {
        if (!cruiseOrchestrator) return [];
        return cruiseOrchestrator.listRuns();
      },
      pause: async (runId: number) => {
        if (!cruiseOrchestrator) throw new Error('cruise orchestrator not initialized');
        await cruiseOrchestrator.pause(runId);
      },
      resume: async (runId: number) => {
        if (!cruiseOrchestrator) throw new Error('cruise orchestrator not initialized');
        await cruiseOrchestrator.resume(runId);
      },
      stop: async (runId: number) => {
        if (!cruiseOrchestrator) throw new Error('cruise orchestrator not initialized');
        await cruiseOrchestrator.stop(runId);
      },
      approvePRD: async (runId: number) => {
        if (!cruiseOrchestrator) throw new Error('cruise orchestrator not initialized');
        await cruiseOrchestrator.approvePRD(runId);
      },
    },
  });
  helmIPCServer.start();

  // Cruise Control orchestrator — spawns and drives multi-agent runs
  cruiseOrchestrator = new CruiseOrchestrator(db, ptyManager, {
    spawnTab: (label: string, ctx: PendingTabContext) => {
      const tabId = `cruise-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ptyManager?.setPendingContext(tabId, ctx);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('helm:new-tab', { tabId, label });
      }
      return tabId;
    },
    broadcast: (channel: string, payload: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    },
  });
  cruiseOrchestrator.attach();

  // Build an application menu with an "Install CLI…" item
  buildApplicationMenu();

  // Set up IPC handlers
  setupIPCHandlers();

  // Validate auth session with backend on launch
  syncWithBackend().then((valid) => {
    console.log(valid ? '✅ Auth session validated' : 'ℹ️ No active auth session');
  });

  // Auto-sync every 30 minutes
  setInterval(() => {
    syncWithBackend().then((synced) => {
      if (synced) console.log('🔄 Background sync complete');
    });
  }, 30 * 60 * 1000);

  // Sync when app window gains focus (user switches back to HELM)
  mainWindow.on('focus', () => {
    syncWithBackend().catch(() => {});
  });
}

function setupIPCHandlers() {
  // Terminal PTY handlers (multi-tab)
  ipcMain.handle('pty:start', async (_, tabId: string) => {
    if (!ptyManager) throw new Error('PTY Manager not initialized');
    const id = tabId || 'default';
    const { cols, rows } = await mainWindow!.webContents.executeJavaScript(
      'window.innerWidth && window.innerHeight ? { cols: Math.floor(window.innerWidth / 9), rows: Math.floor(window.innerHeight / 17) } : { cols: 80, rows: 24 }'
    );
    const result = await ptyManager.start(id, cols, rows);

    // Only register listeners for newly created PTYs
    if (result.isNew) {
      ptyManager.onData(id, (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:data', id, data);
        }
        // Forward PTY output to mobile clients
        if (mobileServer) {
          mobileServer.broadcastPTYData(id, data);
        }
      });

      ptyManager.onExit(id, (exitCode) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('pty:exit', id, exitCode);
        }
      });
    }

    return result;
  });

  ipcMain.on('pty:write', (_, tabId: string, data: string) => {
    ptyManager?.write(tabId || 'default', data);
  });

  ipcMain.on('pty:resize', (_, tabId: string, cols: number, rows: number) => {
    ptyManager?.resize(tabId || 'default', cols, rows);
  });

  ipcMain.handle('pty:kill', async (_, tabId: string) => {
    ptyManager?.kill(tabId || 'default');
  });

  ipcMain.handle('pty:recentCommands', async (_, tabId: string) => {
    return ptyManager?.getRecentCommands(tabId || 'default') || [];
  });

  ipcMain.handle('pty:memoryUsage', async () => {
    return ptyManager?.getAllMemoryUsage() || {};
  });

  // Directory listing for address bar autocomplete
  ipcMain.handle('fs:listDirs', async (_, inputPath: string) => {
    try {
      // Expand ~ to home directory
      const expanded = inputPath.replace(/^~/, os.homedir());

      // If the input starts with / or ~, do path-based completion
      if (inputPath.startsWith('/') || inputPath.startsWith('~')) {
        const isComplete = expanded.endsWith('/');
        const dir = isComplete ? expanded : path.dirname(expanded);
        const partial = isComplete ? '' : path.basename(expanded).toLowerCase();

        if (!fs.existsSync(dir)) return [];

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .filter(e => !partial || e.name.toLowerCase().startsWith(partial))
          .slice(0, 10)
          .map(e => {
            const full = path.join(dir, e.name);
            return full.replace(os.homedir(), '~');
          });
      }

      // Otherwise, search common locations for matching directory names
      const query = inputPath.toLowerCase();
      const results: string[] = [];
      const searchRoots = [
        os.homedir(),
        path.join(os.homedir(), 'Documents'),
        path.join(os.homedir(), 'Desktop'),
        path.join(os.homedir(), 'Projects'),
        path.join(os.homedir(), 'Developer'),
        path.join(os.homedir(), 'Downloads'),
      ];

      for (const root of searchRoots) {
        if (!fs.existsSync(root)) continue;
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true });
          for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.')) continue;
            if (e.name.toLowerCase().includes(query)) {
              const full = path.join(root, e.name);
              results.push(full.replace(os.homedir(), '~'));
            }
          }
        } catch { /* skip unreadable dirs */ }
        if (results.length >= 10) break;
      }

      return results.slice(0, 10);
    } catch {
      return [];
    }
  });

  // AI handlers
  // AI handlers with usage tracking
  const checkAccess = () => {
    if (!licenseManager) return;
    if (!licenseManager.canUseAI()) {
      const tier = licenseManager.getTier();
      if (tier === 'free') {
        throw new Error('You\'ve used all 20 free AI requests this month. Upgrade for more AI access.');
      }
      throw new Error('Monthly AI request limit reached. Upgrade your plan for more requests.');
    }
  };

  const trackUsage = (type: string) => {
    licenseManager?.recordAICall();
    // Report usage to backend for all tiers
    const s = loadSettings();
    const model = s.aiProvider === 'anthropic' ? s.anthropicModel : s.openaiModel;
    licenseManager?.recordUsageToBackend(type, model);
  };

  ipcMain.handle('ai:ask', async (_, question: string, context?: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    checkAccess();
    const result = await aiService.ask(question, context);
    trackUsage('chat');
    return result;
  });

  ipcMain.handle('ai:explain', async (_, command: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    checkAccess();
    const result = await aiService.explainCommand(command);
    trackUsage('explain');
    return result;
  });

  ipcMain.handle('ai:suggest', async (_, intent: string, workingDir: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    checkAccess();
    const result = await aiService.suggestCommand(intent, workingDir);
    trackUsage('suggest');
    return result;
  });

  // Keep old IPC names working for now (aliases)
  ipcMain.handle('claude:ask', async (_, question: string, context?: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.ask(question, context);
  });

  ipcMain.handle('claude:explain', async (_, command: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.explainCommand(command);
  });

  ipcMain.handle('claude:suggest', async (_, intent: string, workingDir: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.suggestCommand(intent, workingDir);
  });

  // Database handlers
  ipcMain.handle('db:getCommands', async (_, sessionId?: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getCommands(sessionId);
  });

  ipcMain.handle('db:getGroupedCommands', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getGroupedCommands();
  });

  ipcMain.handle('db:getCommand', async (_, commandId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getCommand(commandId);
  });

  ipcMain.handle('db:bookmarkCommand', async (_, commandId: number, title: string, notes?: string, tags?: string[]) => {
    if (!db) throw new Error('Database not initialized');
    return db.bookmarkCommand(commandId, title, notes, tags);
  });

  ipcMain.handle('db:unbookmarkCommand', async (_, commandId: number) => {
    if (!db) throw new Error('Database not initialized');
    await db.unbookmarkCommand(commandId);
    return true;
  });

  ipcMain.handle('db:getBookmarkedCommandIds', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getBookmarkedCommandIds();
  });

  ipcMain.handle('db:getBookmarks', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getBookmarks();
  });

  ipcMain.handle('db:saveLesson', async (_, title: string, description: string, sessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.saveLesson(title, description, sessionId);
  });

  ipcMain.handle('db:getLessons', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getLessons();
  });

  ipcMain.handle('db:getExplainedCommandInputs', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getExplainedCommandInputs();
  });

  ipcMain.handle('db:getExplanation', async (_, commandInput: string) => {
    if (!db) throw new Error('Database not initialized');
    return db.getExplanation(commandInput);
  });

  ipcMain.handle('db:saveExplanation', async (_, commandId: number, explanation: any) => {
    if (!db) throw new Error('Database not initialized');
    return db.saveExplanation(
      commandId,
      explanation.summary || '',
      explanation.breakdown || [],
      explanation.expectedOutcome || '',
      explanation.failureModes || [],
      explanation.undoGuidance || null
    );
  });

  ipcMain.handle('db:getSessions', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getSessions();
  });

  ipcMain.handle('db:getSessionCommands', async (_, sessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getSessionCommands(sessionId);
  });

  ipcMain.handle('db:deleteSession', async (_, sessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    await db.deleteSession(sessionId);
    return true;
  });

  ipcMain.handle('db:clearHistory', async () => {
    if (!db) throw new Error('Database not initialized');
    await db.clearHistory();
    return true;
  });

  // CLI session tracking handlers
  ipcMain.handle('db:getCLISessions', async (_, sessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getCLISessions(sessionId);
  });

  ipcMain.handle('db:getCLIInputs', async (_, cliSessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getCLIInputs(cliSessionId);
  });

  ipcMain.handle('db:getSessionCommandsWithCLI', async (_, sessionId: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getSessionCommandsWithCLI(sessionId);
  });

  ipcMain.handle('db:getRecentCLIInputs', async (_, limit?: number) => {
    if (!db) throw new Error('Database not initialized');
    return db.getRecentCLIInputs(limit);
  });

  // Autocomplete handlers
  ipcMain.handle('autocomplete:searchHistory', async (_, prefix: string, limit?: number) => {
    if (!db) return [];
    try {
      return await db.searchCommandHistory(prefix, limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle('autocomplete:frequentCommands', async (_, limit?: number) => {
    if (!db) return [];
    try {
      return await db.getFrequentCommands(limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle('autocomplete:pathComplete', async (_, partialPath: string, cwd: string) => {
    try {
      // Expand ~ to home directory
      let expanded = partialPath.replace(/^~/, os.homedir());

      // If path is relative, resolve against cwd
      if (!expanded.startsWith('/')) {
        expanded = path.join(cwd || os.homedir(), expanded);
      }

      const isComplete = expanded.endsWith('/');
      const dir = isComplete ? expanded : path.dirname(expanded);
      const partial = isComplete ? '' : path.basename(expanded).toLowerCase();

      if (!fs.existsSync(dir)) return [];

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.'))
        .filter(e => !partial || e.name.toLowerCase().startsWith(partial))
        .slice(0, 15)
        .map(e => {
          const isDir = e.isDirectory();
          const name = isDir ? e.name + '/' : e.name;
          // Build the completion relative to what the user typed
          if (isComplete) {
            return partialPath + name;
          }
          const parentPart = partialPath.substring(0, partialPath.lastIndexOf('/') + 1);
          return parentPart + name;
        });
    } catch {
      return [];
    }
  });

  // Session search handlers
  ipcMain.handle('db:searchAll', async (_, params: {
    query: string;
    dateFrom?: string;
    dateTo?: string;
    sessionId?: number;
    cliProgram?: string;
    limit?: number;
    offset?: number;
  }) => {
    if (!db) throw new Error('Database not initialized');
    return db.searchAll(params);
  });

  ipcMain.handle('db:getDistinctCLIPrograms', async () => {
    if (!db) throw new Error('Database not initialized');
    return db.getDistinctCLIPrograms();
  });

  ipcMain.handle('pty:getActiveCLI', async (_, tabId: string) => {
    return ptyManager?.getActiveCLI(tabId) || null;
  });

  ipcMain.handle('pty:resumeSession', async (_, tabId: string, sessionId: number, workingDir: string) => {
    ptyManager?.resumeSession(tabId, sessionId, workingDir);
    return true;
  });

  // Settings handlers
  ipcMain.handle('settings:load', async () => {
    return loadSettings();
  });

  ipcMain.handle('settings:save', async (_, settings: any) => {
    saveSettings(settings);
    aiService = createAIService(settings);
    return true;
  });

  // Licensing handlers
  ipcMain.handle('license:get', async () => {
    return licenseManager?.getLicense() || null;
  });

  ipcMain.handle('license:getUsage', async () => {
    return licenseManager?.getUsageSummary() || null;
  });

  ipcMain.handle('license:getFeatures', async () => {
    return licenseManager?.getFeatureFlags() || {};
  });

  ipcMain.handle('license:hasFeature', async (_, feature: string) => {
    return licenseManager?.hasFeature(feature as any) || false;
  });

  ipcMain.handle('license:activate', async (_, email: string, licenseKey: string) => {
    if (!licenseManager) return { success: false, error: 'License manager not initialized' };
    const result = await licenseManager.activateLicense(email, licenseKey);
    if (result.success) {
      // Recreate AI service to reflect new tier
      aiService = createAIService();
    }
    return result;
  });

  ipcMain.handle('license:deactivate', async () => {
    licenseManager?.deactivateLicense();
    aiService = createAIService();
    return true;
  });

  // Auth handlers
  ipcMain.handle('auth:getState', async () => {
    return licenseManager?.getAuthState() || {
      isAuthenticated: false,
      email: null,
      userName: null,
      userId: null,
      tier: 'free',
    };
  });

  ipcMain.handle('auth:login', async (_, email: string, password: string) => {
    if (!licenseManager) return { success: false, error: 'License manager not initialized' };
    const result = await licenseManager.login(email, password);
    if (result.success) {
      aiService = createAIService();
      // Notify renderer of auth state change
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:stateChanged', licenseManager.getAuthState());
      }
    }
    return result;
  });

  ipcMain.handle('auth:logout', async () => {
    licenseManager?.logout();
    aiService = createAIService();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:stateChanged', licenseManager!.getAuthState());
    }
    return true;
  });

  ipcMain.handle('auth:sync', async () => {
    const synced = await syncWithBackend();
    return {
      success: synced,
      usage: licenseManager?.getUsageSummary() || null,
      authState: licenseManager?.getAuthState() || null,
    };
  });

  ipcMain.handle('auth:openLogin', async () => {
    if (!licenseManager) return;
    await startAuthFlowInBrowser('login');
  });

  ipcMain.handle('auth:openRegister', async () => {
    if (!licenseManager) return;
    await startAuthFlowInBrowser('register');
  });

  ipcMain.handle('auth:openPricing', async () => {
    if (!licenseManager) return;
    const url = licenseManager.getPricingUrl();
    shell.openExternal(url);
  });

  // ── Mobile Access handlers ─────────────────────────────────────

  ipcMain.handle('mobile:getStatus', async () => {
    return mobileServer?.getStatus() || { running: false, port: 8384, connectedDevices: 0, pairedDevices: [], localIP: null, accessUrl: null };
  });

  ipcMain.handle('mobile:getSettings', async () => {
    return mobileServer?.getSettings() || { enabled: false, port: 8384, idleTimeoutMinutes: 15, pairedDevices: [] };
  });

  ipcMain.handle('mobile:updateSettings', async (_, settings: any) => {
    if (!mobileServer) return;
    mobileServer.updateSettings(settings);
  });

  ipcMain.handle('mobile:start', async () => {
    if (!mobileServer) throw new Error('Mobile server not initialized');

    // Wire up PTY callbacks before starting
    mobileServer.setPTYCallbacks(
      // write
      (tabId: string, data: string) => {
        ptyManager?.write(tabId, data);
      },
      // resize
      (tabId: string, cols: number, rows: number) => {
        ptyManager?.resize(tabId, cols, rows);
      },
      // getTabs — read from renderer tab state via mainWindow
      () => {
        // We return a simple list; the renderer manages the canonical tab list.
        // This reads from the saved tabs in localStorage via the settings file approach.
        try {
          const saved = require('fs').readFileSync(
            require('path').join(require('os').homedir(), '.helm-settings.json'), 'utf-8'
          );
          // Tabs are stored in localStorage, not the settings file.
          // Instead, we query the renderer.
        } catch { /* ignore */ }
        // Fallback: return empty — tabs will be sent when renderer notifies us.
        return [];
      },
      // addDataListener (already handled via broadcastPTYData in the onData hook)
      (_tabId: string, _callback: (data: string) => void) => {
        // Data forwarding is handled by the broadcastPTYData call in the pty:start handler
      }
    );

    await mobileServer.start();
    mobileServer.updateSettings({ enabled: true });
  });

  ipcMain.handle('mobile:stop', async () => {
    if (!mobileServer) return;
    mobileServer.stop();
    mobileServer.updateSettings({ enabled: false });
  });

  ipcMain.handle('mobile:generatePIN', async () => {
    if (!mobileServer) throw new Error('Mobile server not initialized');
    return mobileServer.generatePIN();
  });

  ipcMain.handle('mobile:getQRCode', async () => {
    if (!mobileServer) return null;
    const status = mobileServer.getStatus();
    if (!status.accessUrl) return null;
    try {
      const QRCode = require('qrcode');
      return await QRCode.toDataURL(status.accessUrl, { width: 200, margin: 1 });
    } catch {
      return null;
    }
  });

  ipcMain.handle('mobile:revokeDevice', async (_, deviceId: string) => {
    if (!mobileServer) return;
    mobileServer.revokeDevice(deviceId);
  });

  ipcMain.handle('mobile:getPairedDevices', async () => {
    return mobileServer?.getPairedDevices() || [];
  });

  // CLI installer — called from the HELM app menu
  ipcMain.handle('helm:installCLI', async () => {
    return await installCLI();
  });

  // Renderer replies to a tabs-request initiated by the `helm` CLI
  ipcMain.on('helm:tabsResponse', (_, requestId: string, tabs: any[]) => {
    const resolver = pendingTabRequests.get(requestId);
    if (!resolver) return;
    pendingTabRequests.delete(requestId);
    const parsed: TabInfo[] = (tabs || []).map((t: any) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
    // Keep the cache warm for fallback use
    lastReportedTabs = parsed;
    resolver(parsed);
  });

  // ── Cruise Control handlers ────────────────────────────────────

  ipcMain.handle('cruise:listRuns', async () => {
    if (!cruiseOrchestrator) return [];
    return cruiseOrchestrator.listRuns();
  });

  ipcMain.handle('cruise:getRun', async (_, runId: number) => {
    if (!cruiseOrchestrator) return null;
    return cruiseOrchestrator.getRun(runId);
  });

  ipcMain.handle('cruise:start', async (_, config: CruiseRunConfig) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    return cruiseOrchestrator.start(config);
  });

  ipcMain.handle('cruise:pause', async (_, runId: number) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.pause(runId);
    return { ok: true };
  });

  ipcMain.handle('cruise:resume', async (_, runId: number) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.resume(runId);
    return { ok: true };
  });

  ipcMain.handle('cruise:stop', async (_, runId: number) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.stop(runId);
    return { ok: true };
  });

  ipcMain.handle('cruise:delete', async (_, runId: number) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.delete(runId);
    return { ok: true };
  });

  ipcMain.handle('cruise:approvePRD', async (_, runId: number, editedContent?: string) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.approvePRD(runId, editedContent);
    return { ok: true };
  });

  ipcMain.handle('cruise:submitReviewDecision', async (_, runId: number, decision: 'accept' | 'request-changes') => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.submitReviewDecision(runId, decision);
    return { ok: true };
  });

  ipcMain.handle('cruise:continueWithGoals', async (_, runId: number, goals: string[]) => {
    if (!cruiseOrchestrator) throw new Error('Cruise orchestrator not initialized');
    await cruiseOrchestrator.continueWithGoals(runId, goals);
    return { ok: true };
  });

  ipcMain.handle('cruise:pickRepo', async () => {
    if (!mainWindow) return { path: null };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select target repository (must contain AGENTS.md and PRD.md)',
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  // Renderer notifies us of tab list changes
  ipcMain.on('mobile:tabsChanged', (_, tabs: any[]) => {
    lastReportedTabs = (tabs || []).map((t: any) => ({
      id: t.id,
      label: t.label,
      description: t.description,
    }));
    if (mobileServer) {
      // Update the getTabs callback to return current tabs
      const currentTabs = tabs;
      mobileServer.setPTYCallbacks(
        (tabId: string, data: string) => { ptyManager?.write(tabId, data); },
        (tabId: string, cols: number, rows: number) => { ptyManager?.resize(tabId, cols, rows); },
        () => currentTabs,
        () => { /* handled by broadcastPTYData */ }
      );
      mobileServer.broadcastTabsChanged();
    }
  });

}

// Start a temporary local HTTP server to receive the auth callback from the browser.
// This avoids the helm:// deep link issues in dev mode.
let authCallbackServer: http.Server | null = null;

async function startAuthFlowInBrowser(mode: 'login' | 'register') {
  // Clean up any previous server
  if (authCallbackServer) {
    authCallbackServer.close();
    authCallbackServer = null;
  }

  return new Promise<void>((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '', `http://localhost`);

      if (url.pathname === '/auth/callback') {
        const token = url.searchParams.get('token');

        // Send a nice response page that auto-closes
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>HELM - Signed In</title>
            <style>
              body { font-family: -apple-system, system-ui, sans-serif; background: #030303; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
              .container { text-align: center; max-width: 400px; }
              .check { width: 64px; height: 64px; margin: 0 auto 24px; background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
              h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; letter-spacing: -0.03em; }
              p { color: #888; font-size: 14px; line-height: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="check">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h1>You're all set!</h1>
              <p>You've been signed in. You can return to the HELM app now.<br>This tab can be closed.</p>
            </div>
          </body>
          </html>
        `);

        // Process the token
        if (token && licenseManager) {
          const result = await licenseManager.handleAuthCallback(token);
          if (result.success) {
            aiService = createAIService();
            console.log('✅ Auth callback: logged in via local server');
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:stateChanged', licenseManager.getAuthState());
          }
        }

        // Focus the app window
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }

        // Shut down the callback server after a short delay
        setTimeout(() => {
          server.close();
          authCallbackServer = null;
        }, 1000);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Listen on a random available port
    server.listen(0, '127.0.0.1', () => {
      authCallbackServer = server;
      const addr = server.address() as any;
      const callbackPort = addr.port;
      const callbackUrl = `http://127.0.0.1:${callbackPort}/auth/callback`;

      // Build the web URL with the localhost callback
      const webBase = app.isPackaged ? 'https://helm.lanaai.io' : 'http://localhost:1234';
      const page = mode === 'login' ? 'login' : 'register';
      const webUrl = `${webBase}/helm/${page}?callback=${encodeURIComponent(callbackUrl)}`;

      console.log(`🔗 Auth flow: opening ${webUrl}`);
      console.log(`🔗 Callback server listening on port ${callbackPort}`);

      shell.openExternal(webUrl);
      resolve();
    });
  });
}

app.whenReady().then(createWindow);

// Handle deep links (helm://auth/callback?token=xxx) — used in packaged builds
function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
      const token = parsed.searchParams.get('token');
      if (token && licenseManager) {
        licenseManager.handleAuthCallback(token).then((result) => {
          if (result.success) {
            aiService = createAIService();
            console.log('✅ Auth callback: logged in');
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:stateChanged', licenseManager!.getAuthState());
          }
        });
      }
    }
  } catch {}
}

// macOS: handle URL when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
  // Focus the app window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Ensure single instance — second instance passes URL to first
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Windows/Linux: deep link URL comes in commandLine
    const url = commandLine.find(arg => arg.startsWith('helm://'));
    if (url) handleDeepLink(url);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  mobileServer?.stop();
  helmIPCServer?.stop();
  ptyManager?.killAll();
  db?.close();
});

function readVersionInfo(): { appVersion: string; shimVersion: string } {
  let appVersion = app.getVersion();
  // Read the shim version from the bundled helm shim file
  let shimVersion = 'unknown';
  try {
    const shimPath = app.isPackaged
      ? path.join(process.resourcesPath, 'cli', 'helm')
      : path.join(__dirname, '..', '..', 'src', 'main', 'cli', 'helm');
    const shimSrc = fs.readFileSync(shimPath, 'utf-8');
    const m = shimSrc.match(/const\s+SHIM_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m) shimVersion = m[1];
  } catch {}
  return { appVersion, shimVersion };
}

function requestTabsFromRenderer(timeoutMs = 500): Promise<TabInfo[]> {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve(lastReportedTabs);
      return;
    }
    const requestId = `tabs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      if (pendingTabRequests.has(requestId)) {
        pendingTabRequests.delete(requestId);
        resolve(lastReportedTabs); // fall back to cache
      }
    }, timeoutMs);
    pendingTabRequests.set(requestId, (tabs) => {
      clearTimeout(timer);
      resolve(tabs);
    });
    mainWindow.webContents.send('helm:requestTabs', requestId);
  });
}

function buildApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'HELM',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Install CLI…',
          click: async () => {
            const result = await installCLI();
            if (result.ok) {
              await dialog.showMessageBox({
                type: 'info',
                message: 'helm CLI installed',
                detail: `Installed at ${result.path}\n\nYou can now run "helm" from any terminal.${result.note ? '\n\n' + result.note : ''}`,
              });
            } else {
              await dialog.showMessageBox({
                type: 'error',
                message: 'Could not install helm CLI',
                detail: result.error || 'Unknown error',
              });
            }
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
