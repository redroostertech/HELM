# Start Tuttle

## Quick Start (First Time)

```bash
# Make sure you're in the tuttle directory
cd /Users/redroostertechnologies/Documents/tuttle

# 1. Database should already be set up
# If not, run: npm run setup:db

# 2. Start the app
npm run dev
```

## What You'll See

**Console Output:**
```
[0] Vite dev server running on http://localhost:5173
[1] Electron starting...
[1] ✅ PostgreSQL database initialized
```

**Electron Window Opens:**
```
┌─────────────────────────────────────────────┐
│  📁 ~/Documents/tuttle         [Go]         │ ← Address Bar
├──────────────────────────┬──────────────────┤
│                          │  📚  |  💡       │ ← Tabs
│                          ├──────────────────┤
│    Terminal              │                  │
│    (type here!)          │   History or     │
│                          │   Explain        │
│                          │                  │
└──────────────────────────┴──────────────────┘
```

## First Commands to Try

### 1. Use the Terminal
Just type normal commands:
```bash
ls
pwd
echo "Hello Tuttle"
```

### 2. Check History
- Click the **📚 History** tab
- See all your commands
- Click any command to explain it

### 3. Ask Claude
- Click the emoji in address bar (📁 → 💬)
- Type: "How do I list files?"
- See explanation in Explain pane

### 4. Navigate (Coming Soon)
Address bar directory navigation will be implemented next

---

## Troubleshooting

### "Port 5173 is in use"
**Solution:** Kill other Vite processes
```bash
lsof -ti:5173 | xargs kill -9
npm run dev
```

### "Cannot connect to PostgreSQL"
**Solution:** Make sure PostgreSQL is running
```bash
brew services start postgresql@16
npm run dev
```

### "Database 'tuttle' does not exist"
**Solution:** Run setup script
```bash
npm run setup:db
npm run dev
```

### Electron window is blank
**Solution:** Wait for Vite to start first, then refresh
- Press **Cmd+R** in Electron window
- Or restart: `npm run dev`

---

## Development Tips

**View Console Logs:**
- Electron window: **Cmd+Option+I** (DevTools)
- Terminal: See `[0]` and `[1]` output

**Hot Reload:**
- React changes reload automatically
- Electron changes need restart

**Stop the App:**
- Press **Ctrl+C** in terminal
- Or close Electron window

---

Ready? Run:
```bash
npm run dev
```
