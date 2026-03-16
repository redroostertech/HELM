import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

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
import { LlamaCppService } from './llamacpp-service';
import { LicenseManager } from './licensing';

let mainWindow: BrowserWindow | null = null;
let ptyManager: PTYManager | null = null;
let db: DatabaseManager | null = null;
let aiService: AIService | null = null;
let localAIService: LlamaCppService | null = null;
let licenseManager: LicenseManager | null = null;

function createAIService(settings?: any): AIService {
  const s = settings || loadSettings();
  const tier = licenseManager?.getTier() || 'free';

  // Local model for free users or when explicitly selected
  if (s.aiProvider === 'local' || (tier === 'free' && !s.openaiApiKey && !s.anthropicApiKey)) {
    if (localAIService && localAIService.hasModel()) {
      console.log('🦙 Using local AI (llama.cpp)');
      return localAIService;
    }
  }

  // Cloud providers for pro/team users or when API key is provided
  if (s.aiProvider === 'anthropic' && s.anthropicApiKey) {
    console.log('🧠 Using Anthropic (Claude) API');
    return new AnthropicService(s.anthropicApiKey, s.anthropicModel);
  }

  if (s.openaiApiKey) {
    console.log('🧠 Using OpenAI API');
    return new OpenAIService(s.openaiApiKey, s.openaiModel);
  }

  // Fallback to local if available
  if (localAIService && localAIService.hasModel()) {
    console.log('🦙 Falling back to local AI (no API keys configured)');
    return localAIService;
  }

  console.log('🧠 Using OpenAI API (no key - will error on use)');
  return new OpenAIService(s.openaiApiKey, s.openaiModel);
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
  ptyManager = new PTYManager(db);
  licenseManager = new LicenseManager();

  // Initialize local AI (non-blocking)
  localAIService = new LlamaCppService();
  if (localAIService.isAvailable() && localAIService.hasModel()) {
    console.log(`🦙 Local AI available: ${localAIService.getModelSizeMB()} MB model`);
    localAIService.startServer().catch(err => {
      console.warn('🦙 Local AI failed to start:', err.message);
    });
  } else {
    console.log('🦙 Local AI not available (missing server or model)');
  }

  aiService = createAIService();

  // Set up IPC handlers
  setupIPCHandlers();
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
  ipcMain.handle('ai:ask', async (_, question: string, context?: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.ask(question, context);
  });

  ipcMain.handle('ai:explain', async (_, command: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.explainCommand(command);
  });

  ipcMain.handle('ai:suggest', async (_, intent: string, workingDir: string) => {
    if (!aiService) throw new Error('AI service not initialized');
    return aiService.suggestCommand(intent, workingDir);
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

  ipcMain.handle('db:clearHistory', async () => {
    if (!db) throw new Error('Database not initialized');
    await db.clearHistory();
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

  // Local AI status
  ipcMain.handle('localai:status', async () => {
    return {
      available: localAIService?.isAvailable() || false,
      hasModel: localAIService?.hasModel() || false,
      modelSizeMB: localAIService?.getModelSizeMB() || 0,
      serverRunning: localAIService?.provider === 'local',
    };
  });
}

app.whenReady().then(createWindow);

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
  localAIService?.stopServer();
  db?.close();
});
