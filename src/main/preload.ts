import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // PTY methods (multi-tab)
  ptyStart: (tabId?: string) => ipcRenderer.invoke('pty:start', tabId),
  ptyWrite: (tabIdOrData: string, data?: string) => {
    // Support both old (data) and new (tabId, data) signatures
    if (data !== undefined) {
      ipcRenderer.send('pty:write', tabIdOrData, data);
    } else {
      ipcRenderer.send('pty:write', 'default', tabIdOrData);
    }
  },
  ptyResize: (tabIdOrCols: string | number, colsOrRows?: number, rows?: number) => {
    if (typeof tabIdOrCols === 'string') {
      ipcRenderer.send('pty:resize', tabIdOrCols, colsOrRows, rows);
    } else {
      ipcRenderer.send('pty:resize', 'default', tabIdOrCols, colsOrRows);
    }
  },
  ptyKill: (tabId?: string) => ipcRenderer.invoke('pty:kill', tabId),
  onPtyData: (callback: (tabId: string, data: string) => void) => {
    const handler = (_: any, tabId: string, data: string) => callback(tabId, data);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },
  onPtyExit: (callback: (tabId: string, exitCode: number) => void) => {
    const handler = (_: any, tabId: string, exitCode: number) => callback(tabId, exitCode);
    ipcRenderer.on('pty:exit', handler);
    return () => ipcRenderer.removeListener('pty:exit', handler);
  },
  ptyRecentCommands: (tabId: string) => ipcRenderer.invoke('pty:recentCommands', tabId),
  ptyMemoryUsage: () => ipcRenderer.invoke('pty:memoryUsage'),

  // AI methods
  aiAsk: (question: string, context?: string) =>
    ipcRenderer.invoke('ai:ask', question, context),
  aiExplain: (command: string) =>
    ipcRenderer.invoke('ai:explain', command),
  aiSuggest: (intent: string, workingDir: string) =>
    ipcRenderer.invoke('ai:suggest', intent, workingDir),

  // Legacy aliases
  claudeAsk: (question: string, context?: string) =>
    ipcRenderer.invoke('ai:ask', question, context),
  claudeExplain: (command: string) =>
    ipcRenderer.invoke('ai:explain', command),
  claudeSuggest: (intent: string, workingDir: string) =>
    ipcRenderer.invoke('ai:suggest', intent, workingDir),

  // Filesystem
  fsListDirs: (inputPath: string) =>
    ipcRenderer.invoke('fs:listDirs', inputPath),

  // Settings
  settingsLoad: () => ipcRenderer.invoke('settings:load'),
  settingsSave: (settings: any) => ipcRenderer.invoke('settings:save', settings),

  // Licensing
  licenseGet: () => ipcRenderer.invoke('license:get'),
  licenseGetUsage: () => ipcRenderer.invoke('license:getUsage'),
  licenseGetFeatures: () => ipcRenderer.invoke('license:getFeatures'),
  licenseHasFeature: (feature: string) => ipcRenderer.invoke('license:hasFeature', feature),
  licenseActivate: (email: string, licenseKey: string) =>
    ipcRenderer.invoke('license:activate', email, licenseKey),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),

  // Auth
  authGetState: () => ipcRenderer.invoke('auth:getState'),
  authLogin: (email: string, password: string) =>
    ipcRenderer.invoke('auth:login', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authSync: () => ipcRenderer.invoke('auth:sync'),
  authOpenLogin: () => ipcRenderer.invoke('auth:openLogin'),
  authOpenRegister: () => ipcRenderer.invoke('auth:openRegister'),
  authOpenPricing: () => ipcRenderer.invoke('auth:openPricing'),
  onAuthStateChanged: (callback: (state: any) => void) => {
    const handler = (_: any, state: any) => callback(state);
    ipcRenderer.on('auth:stateChanged', handler);
    return () => ipcRenderer.removeListener('auth:stateChanged', handler);
  },
  onLicenseUpdated: (callback: (usage: any) => void) => {
    const handler = (_: any, usage: any) => callback(usage);
    ipcRenderer.on('license:updated', handler);
    return () => ipcRenderer.removeListener('license:updated', handler);
  },

  // Database
  dbGetCommands: (sessionId?: number) =>
    ipcRenderer.invoke('db:getCommands', sessionId),
  dbGetGroupedCommands: () =>
    ipcRenderer.invoke('db:getGroupedCommands'),
  dbGetCommand: (commandId: number) =>
    ipcRenderer.invoke('db:getCommand', commandId),
  dbBookmarkCommand: (commandId: number, title: string, notes?: string, tags?: string[]) =>
    ipcRenderer.invoke('db:bookmarkCommand', commandId, title, notes, tags),
  dbUnbookmarkCommand: (commandId: number) =>
    ipcRenderer.invoke('db:unbookmarkCommand', commandId),
  dbGetBookmarkedCommandIds: () =>
    ipcRenderer.invoke('db:getBookmarkedCommandIds'),
  dbGetBookmarks: () =>
    ipcRenderer.invoke('db:getBookmarks'),
  dbGetExplainedCommandInputs: () =>
    ipcRenderer.invoke('db:getExplainedCommandInputs'),
  dbGetExplanation: (commandInput: string) =>
    ipcRenderer.invoke('db:getExplanation', commandInput),
  dbSaveExplanation: (commandId: number, explanation: any) =>
    ipcRenderer.invoke('db:saveExplanation', commandId, explanation),
  dbGetSessions: () =>
    ipcRenderer.invoke('db:getSessions'),
  dbGetSessionCommands: (sessionId: number) =>
    ipcRenderer.invoke('db:getSessionCommands', sessionId),
  dbDeleteSession: (sessionId: number) =>
    ipcRenderer.invoke('db:deleteSession', sessionId),
  dbClearHistory: () =>
    ipcRenderer.invoke('db:clearHistory'),
  dbSaveLesson: (title: string, description: string, sessionId: number) =>
    ipcRenderer.invoke('db:saveLesson', title, description, sessionId),
  dbGetLessons: () =>
    ipcRenderer.invoke('db:getLessons'),

  // CLI session tracking
  dbGetCLISessions: (sessionId: number) =>
    ipcRenderer.invoke('db:getCLISessions', sessionId),
  dbGetCLIInputs: (cliSessionId: number) =>
    ipcRenderer.invoke('db:getCLIInputs', cliSessionId),
  dbGetSessionCommandsWithCLI: (sessionId: number) =>
    ipcRenderer.invoke('db:getSessionCommandsWithCLI', sessionId),
  dbGetRecentCLIInputs: (limit?: number) =>
    ipcRenderer.invoke('db:getRecentCLIInputs', limit),
  ptyGetActiveCLI: (tabId: string) =>
    ipcRenderer.invoke('pty:getActiveCLI', tabId),
  ptyResumeSession: (tabId: string, sessionId: number, workingDir: string) =>
    ipcRenderer.invoke('pty:resumeSession', tabId, sessionId, workingDir),
});

export interface ElectronAPI {
  ptyStart: (tabId?: string) => Promise<{ pid: number }>;
  ptyWrite: (tabIdOrData: string, data?: string) => void;
  ptyResize: (tabIdOrCols: string | number, colsOrRows?: number, rows?: number) => void;
  ptyKill: (tabId?: string) => Promise<void>;
  onPtyData: (callback: (tabId: string, data: string) => void) => () => void;
  onPtyExit: (callback: (tabId: string, exitCode: number) => void) => () => void;
  ptyRecentCommands: (tabId: string) => Promise<string[]>;
  ptyMemoryUsage: () => Promise<Record<string, number>>;

  aiAsk: (question: string, context?: string) => Promise<string>;
  aiExplain: (command: string) => Promise<any>;
  aiSuggest: (intent: string, workingDir: string) => Promise<any>;

  claudeAsk: (question: string, context?: string) => Promise<string>;
  claudeExplain: (command: string) => Promise<any>;
  claudeSuggest: (intent: string, workingDir: string) => Promise<any>;

  licenseGet: () => Promise<any>;
  licenseGetUsage: () => Promise<any>;
  licenseGetFeatures: () => Promise<Record<string, boolean>>;
  licenseHasFeature: (feature: string) => Promise<boolean>;
  licenseActivate: (email: string, licenseKey: string) => Promise<{ success: boolean; error?: string }>;
  licenseDeactivate: () => Promise<boolean>;

  authGetState: () => Promise<{
    isAuthenticated: boolean;
    email: string | null;
    userName: string | null;
    userId: string | null;
    tier: string;
  }>;
  authLogin: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  authLogout: () => Promise<boolean>;
  authSync: () => Promise<{ success: boolean; usage: any; authState: any }>;
  authOpenLogin: () => Promise<void>;
  authOpenRegister: () => Promise<void>;
  authOpenPricing: () => Promise<void>;
  onAuthStateChanged: (callback: (state: any) => void) => () => void;
  onLicenseUpdated: (callback: (usage: any) => void) => () => void;

  fsListDirs: (inputPath: string) => Promise<string[]>;

  settingsLoad: () => Promise<any>;
  settingsSave: (settings: any) => Promise<boolean>;

  dbGetCommands: (sessionId?: number) => Promise<any[]>;
  dbGetGroupedCommands: () => Promise<any[]>;
  dbGetCommand: (commandId: number) => Promise<any>;
  dbBookmarkCommand: (commandId: number, title: string, notes?: string, tags?: string[]) => Promise<number>;
  dbUnbookmarkCommand: (commandId: number) => Promise<boolean>;
  dbGetBookmarkedCommandIds: () => Promise<number[]>;
  dbGetBookmarks: () => Promise<any[]>;
  dbGetExplainedCommandInputs: () => Promise<string[]>;
  dbGetExplanation: (commandInput: string) => Promise<any>;
  dbSaveExplanation: (commandId: number, explanation: any) => Promise<number>;
  dbGetSessions: () => Promise<any[]>;
  dbGetSessionCommands: (sessionId: number) => Promise<any[]>;
  dbDeleteSession: (sessionId: number) => Promise<boolean>;
  dbClearHistory: () => Promise<boolean>;
  dbSaveLesson: (title: string, description: string, sessionId: number) => Promise<number>;
  dbGetLessons: () => Promise<any[]>;

  // CLI session tracking
  dbGetCLISessions: (sessionId: number) => Promise<any[]>;
  dbGetCLIInputs: (cliSessionId: number) => Promise<any[]>;
  dbGetSessionCommandsWithCLI: (sessionId: number) => Promise<any[]>;
  dbGetRecentCLIInputs: (limit?: number) => Promise<any[]>;
  ptyGetActiveCLI: (tabId: string) => Promise<{ programId: string; programName: string } | null>;
  ptyResumeSession: (tabId: string, sessionId: number, workingDir: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
