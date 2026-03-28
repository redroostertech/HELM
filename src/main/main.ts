import { app, BrowserWindow, ipcMain, shell } from 'electron';
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
import { ProxyAIService } from './proxy-ai-service';
import { HelmAPI } from './helm-api';
import { LicenseManager } from './licensing';

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

// Forge API configuration — all AI requests route through Forge
const FORGE_API_KEY = 'rrt-burst-3f24900af81b04ba915d3fda37df147bf297d5e12444dee1a87f54fabec13e6a';
const FORGE_BASE_URL = 'https://forge-api.lanaai.io/v1';

function createAIService(settings?: any): AIService {
  const s = settings || loadSettings();
  const tier = licenseManager?.getTier() || 'free';

  // Priority 1: User has their own API key (BYOK) — call providers directly
  if (s.aiProvider === 'anthropic' && s.anthropicApiKey) {
    console.log('🧠 Using Anthropic (Claude) API — user key (BYOK)');
    return new AnthropicService(s.anthropicApiKey, s.anthropicModel);
  }

  if (s.aiProvider === 'openai' && s.openaiApiKey) {
    console.log('🧠 Using OpenAI API — user key (BYOK)');
    return new OpenAIService(s.openaiApiKey, s.openaiModel);
  }

  // Priority 2: Authenticated user (Free/Basic/Pro) — proxy through backend
  const token = licenseManager?.getToken();
  if (token) {
    console.log(`🧠 Using AI proxy — HELM ${tier} tier (server-side)`);
    return new ProxyAIService(new HelmAPI(), token);
  }

  // Priority 3: Forge fallback — route through Forge gateway (no user key needed)
  console.log('🧠 Using Forge AI gateway (forge-api.lanaai.io)');
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
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Initialize services
  db = new DatabaseManager();
  // Close any sessions left open from a previous run
  db.closeOrphanedSessions().catch(() => {});
  ptyManager = new PTYManager(db);
  licenseManager = new LicenseManager();
  aiService = createAIService();

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

  const isUsingProxy = () => aiService instanceof ProxyAIService;

  const trackUsage = (type: string) => {
    licenseManager?.recordAICall();
    // Only report to backend separately for BYOK users (proxy already tracks on the server)
    if (!isUsingProxy()) {
      const s = loadSettings();
      const model = s.aiProvider === 'anthropic' ? s.anthropicModel : s.openaiModel;
      licenseManager?.recordUsageToBackend(type, model);
    }
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
  ptyManager?.killAll();
  db?.close();
});
