# Tuttle Development Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode

Open **two terminal windows**:

**Terminal 1 - Start Vite dev server (React UI):**
```bash
npm run dev:react
```
Wait for "Local: http://localhost:5173" message

**Terminal 2 - Start Electron:**
```bash
npm run dev:electron
```

Alternatively, use the combined command (runs both in one terminal):
```bash
npm run dev
```

### 3. Test the App

Once Electron launches, you should see:
- **Left pane**: Working terminal (type commands!)
- **Middle pane**: Explain pane (click "Ask Claude" or select commands)
- **Right pane**: Command history

Try these commands in the terminal:
```bash
ls
pwd
echo "Hello Tuttle"
```

Then click on a command in the History pane → explanation should appear in the Explain pane.

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         React UI (Port 5173)            │
│   3-pane layout with xterm.js           │
└─────────────────────────────────────────┘
              ↕ IPC
┌─────────────────────────────────────────┐
│      Electron Main Process              │
│  - PTY Manager (node-pty)               │
│  - Claude Code Service                  │
│  - SQLite Database                      │
└─────────────────────────────────────────┘
              ↕
┌─────────────────────────────────────────┐
│        Your Real Shell (zsh)            │
└─────────────────────────────────────────┘
```

---

## How It Works

### Terminal Flow
1. User types in xterm.js (Terminal Pane)
2. Input sent via IPC to Main Process
3. PTY Manager forwards to real shell
4. Shell output streamed back through IPC
5. xterm.js renders output

### Command Capture
1. PTY Manager detects command execution (Enter key)
2. Saves command + output to SQLite
3. History Pane refreshes
4. User can click command to see details

### Claude Integration
1. User clicks "Ask Claude" or selects a command
2. React component calls `window.electronAPI.claudeExplain()`
3. IPC to Main Process → Claude Code Service
4. Spawns `claude` CLI subprocess
5. Response streamed back to Explain Pane

---

## File Structure

```
src/
├── main/ (Electron main process - Node.js)
│   ├── main.ts              - App entry, window creation
│   ├── pty-manager.ts       - Terminal process management
│   ├── claude-code-service.ts - Claude CLI integration
│   ├── database.ts          - SQLite operations
│   └── preload.ts           - IPC security bridge
│
└── renderer/ (React UI - runs in Electron window)
    ├── App.tsx              - Main layout
    ├── components/
    │   ├── TerminalPane.tsx - xterm.js terminal
    │   ├── ExplainPane.tsx  - Claude explanations
    │   └── HistoryPane.tsx  - Command history
    └── main.tsx             - React entry point
```

---

## Common Issues

### "Cannot find module 'electron'"
Run: `npm install`

### Electron window is blank
Make sure Vite dev server is running first (`npm run dev:react`)

### Terminal not accepting input
- Check browser console for errors
- Verify node-pty compiled correctly (requires Python + build tools on some systems)

### Claude integration not working
- Ensure `claude` CLI is installed: `which claude`
- Test manually: `claude --message "test"`

---

## Next Steps for Development

### Immediate Improvements
1. **Fix command capture** - Currently detects Enter, needs to parse actual commands
2. **Add dangerous command detection** - Warn before `rm -rf`, etc.
3. **Session management** - Track sessions properly, allow switching

### Learning Features
4. **Session replay** - Step through commands one by one
5. **Bookmarks UI** - Better bookmark management
6. **Lessons** - Pre-built tutorials ("Build a React app")

### Project Mode (The Killer Feature)
7. **Guided workflows** - Step-by-step app building
8. **Checkpoints** - Save/restore project state
9. **Forking** - Try different approaches

---

## Building for Production

```bash
# Full build
npm run build

# Package as Mac app (.dmg)
npm run package
```

App will be in `dist/` folder.

---

## Debugging Tips

### Enable verbose logging
In `src/main/main.ts`, add:
```typescript
app.commandLine.appendSwitch('enable-logging')
```

### Inspect Electron main process
```bash
electron --inspect=5858 .
```
Then open `chrome://inspect` in Chrome.

### React DevTools
Already enabled in development mode (Cmd+Option+I)

---

## Contributing

Read MANIFESTO first - it's the north star.

Key principles:
- **Never hide what's happening** from the user
- **Learning > productivity**
- **Understanding > speed**

---

Happy building!
