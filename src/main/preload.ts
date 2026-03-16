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

  // Database
  dbGetCommands: (sessionId?: number) =>
    ipcRenderer.invoke('db:getCommands', sessionId),
  dbGetGroupedCommands: () =>
    ipcRenderer.invoke('db:getGroupedCommands'),
  dbGetCommand: (commandId: number) =>
    ipcRenderer.invoke('db:getCommand', commandId),
  dbBookmarkCommand: (commandId: number, title: string, notes?: string, tags?: string[]) =>
    ipcRenderer.invoke('db:bookmarkCommand', commandId, title, notes, tags),
  dbGetBookmarks: () =>
    ipcRenderer.invoke('db:getBookmarks'),
  dbGetExplanation: (commandInput: string) =>
    ipcRenderer.invoke('db:getExplanation', commandInput),
  dbSaveExplanation: (commandId: number, explanation: any) =>
    ipcRenderer.invoke('db:saveExplanation', commandId, explanation),
  dbGetSessions: () =>
    ipcRenderer.invoke('db:getSessions'),
  dbGetSessionCommands: (sessionId: number) =>
    ipcRenderer.invoke('db:getSessionCommands', sessionId),
  dbClearHistory: () =>
    ipcRenderer.invoke('db:clearHistory'),
  dbSaveLesson: (title: string, description: string, sessionId: number) =>
    ipcRenderer.invoke('db:saveLesson', title, description, sessionId),
  dbGetLessons: () =>
    ipcRenderer.invoke('db:getLessons'),
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

  fsListDirs: (inputPath: string) => Promise<string[]>;

  settingsLoad: () => Promise<any>;
  settingsSave: (settings: any) => Promise<boolean>;

  dbGetCommands: (sessionId?: number) => Promise<any[]>;
  dbGetGroupedCommands: () => Promise<any[]>;
  dbGetCommand: (commandId: number) => Promise<any>;
  dbBookmarkCommand: (commandId: number, title: string, notes?: string, tags?: string[]) => Promise<number>;
  dbGetBookmarks: () => Promise<any[]>;
  dbGetExplanation: (commandInput: string) => Promise<any>;
  dbSaveExplanation: (commandId: number, explanation: any) => Promise<number>;
  dbGetSessions: () => Promise<any[]>;
  dbGetSessionCommands: (sessionId: number) => Promise<any[]>;
  dbClearHistory: () => Promise<boolean>;
  dbSaveLesson: (title: string, description: string, sessionId: number) => Promise<number>;
  dbGetLessons: () => Promise<any[]>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
