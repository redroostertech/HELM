# HELM — Product Roadmap

**Vision:** The AI-powered terminal IDE that captures, understands, and learns from everything you do — including conversations with AI coding assistants.

**Powered by:** LANA AI
**Company:** RedRooster Technologies Inc.
**Last Updated:** March 23, 2026
**Current Version:** 1.0.0

---

## What We Ship Today (v1.0.0)

### Core Terminal
- [x] Electron + React + TypeScript + Vite
- [x] xterm.js terminal with node-pty + Unicode11 support
- [x] Multi-tab terminal support with per-tab sessions
- [x] Browser-like address bar with directory autocomplete
- [x] Tab persistence across restarts
- [x] Per-tab memory usage tracking
- [x] Terminal loading indicator
- [x] Dark and light theme support

### AI Features
- [x] AI-powered command explanation (click any command to explain)
- [x] AI chat panel with conversation history
- [x] Code block injection from chat into terminal ("Run" button)
- [x] OpenAI + Anthropic + local Llama.cpp + backend proxy (swappable)
- [x] AI command suggestions from natural language

### CLI Program Tracking (Unique to HELM)
- [x] CLI program registry (Claude Code, Codex, Aider, GitHub Copilot, Gemini CLI)
- [x] File-based conversation capture for Claude Code (~/.claude/ conversation files)
- [x] Captures both user prompts AND assistant responses
- [x] Session timeline shows CLI programs as expandable groups with colored badges
- [x] Paste-to-terminal button for replaying CLI prompts
- [x] Response display in collapsible blocks

### Session Management
- [x] PostgreSQL-backed command history with grouping and deduplication
- [x] Session continuity across app restarts (reattaches to recent session)
- [x] Working directory tracking (updates on cd commands)
- [x] Session resume (reattaches tab + cd to last directory)
- [x] Empty session cleanup on startup
- [x] Live-updating session list and detail views
- [x] New tabs get their own session

### Learning & Organization
- [x] Command bookmarks with titles, notes, and tags
- [x] Lesson system for learning sessions
- [x] Explain history with caching

### Auth & Licensing
- [x] Browser-based auth flow (local callback server)
- [x] Free / BYOK / Basic / Pro tier support
- [x] Usage tracking and limits
- [x] Backend proxy for non-BYOK users

---

## What Makes HELM Unique

1. **CLI conversation capture** — no other terminal tracks what you ask Claude Code/Codex and what they respond
2. **Session continuity** — sessions persist across restarts with full command + conversation history
3. **Learning-focused** — explain pane, bookmarks, lessons
4. **AI-agnostic** — any provider, including local models
5. **No mandatory login for terminal features**
6. **Mobile terminal access** — interact with your live desktop terminal sessions from your phone over LAN/VPN (no competitor offers this)

---

## Competitive Landscape

| Competitor | Price | Key Strength | Key Weakness |
|-----------|-------|-------------|-------------|
| **Warp** | $0-50/mo | Command Blocks, Workflows, AI Agents | Mandatory login, no tmux, pricing churn |
| **Wave Terminal** | Free/OSS | Graphical widgets, zero-account, BYOK | Immature, small community |
| **iTerm2** | Free/OSS | Rock-solid, privacy-first, tmux, scripting | macOS only, dated UI, basic AI |
| **Tabby** | Free/OSS | SSH client, cross-platform, MCP | Heavy/slow, no native AI |
| **Cursor** | $20-200/mo | Agent mode, Tab completions | Code reversion bugs, security concerns |
| **Windsurf** | $15-200/mo | Cascade agent, Memories | 21+ outages in 4 months |
| **Amazon Q/Kiro** | $0-19/mo | Works in existing terminal, 500+ CLI autocomplete | AWS lock-in |

### Key Market Insights
- **No mandatory login** is a competitive advantage (Warp's #1 complaint)
- **BYOK is table stakes** — users want control over AI costs
- **Reliability > features** — Cursor/Windsurf outages drive users away
- **tmux support is non-negotiable** for power users (Warp's biggest gap)
- **Credit/pricing transparency matters** — opaque systems erode trust
- **Cross-platform is expected** — macOS-only limits market by ~60%
- **Mobile access is an untapped gap** — no terminal lets you interact with desktop sessions from your phone; Termius only does SSH to remote servers

---

## Phase 1: Foundation & Retention (v1.1 - v1.3)

**Goal:** Make HELM sticky for daily use. Users should feel friction leaving.
**Timeline:** Q2 2026

### Command Blocks (v1.1)
Group terminal input/output into visual blocks for easy navigation, copying, and sharing.

- [ ] Each command + its output becomes a discrete, selectable block
- [ ] Click to collapse/expand output
- [ ] Copy entire block (command + output) with one click
- [ ] Share blocks as formatted snippets
- [ ] Navigate between blocks with keyboard shortcuts (Cmd+Up/Down)
- [ ] Search within block output

**Why:** Warp's most loved feature. Transforms terminal from a wall of text into structured, navigable content. No other terminal besides Warp does this.
**Impact:** High — changes daily terminal UX fundamentally.

### Smart Autocomplete (v1.1)
IDE-style dropdown suggestions for CLI commands, flags, and arguments.

- [ ] Autocomplete for top 100 CLIs (git, npm, docker, kubectl, aws, etc.)
- [ ] Show flag descriptions inline (e.g., `git commit -m` shows "commit message")
- [ ] Recent command suggestions based on history
- [ ] Path completion with preview
- [ ] Community-contributed completion specs (open source)

**Why:** Fig/Kiro proved this is high-value. Users shouldn't need to memorize CLI flags.
**Impact:** High — reduces context switching to docs/man pages.

### Session Search (v1.2)
Full-text search across all sessions, commands, and CLI conversations.

- [ ] Search by command text, output content, or CLI conversation content
- [ ] Filter by date range, session, CLI program
- [ ] Search CLI responses (e.g., "find where Claude explained the auth bug")
- [ ] Jump to session context from search results
- [ ] Keyboard shortcut (Cmd+Shift+F) for global search

**Why:** We capture more data than any terminal. Search makes that data a knowledge base.
**Impact:** Medium-high — differentiator that gets more valuable over time.

### Offline Mode (v1.2)
Full terminal functionality without internet. Queue AI requests for when connectivity returns.

- [ ] Terminal, sessions, history, bookmarks work 100% offline
- [ ] AI requests queue and execute when online
- [ ] Local model support (Ollama/Llama.cpp) for offline AI
- [ ] Sync queued data on reconnect

**Why:** Warp requires login/internet. HELM working offline is a trust signal.
**Impact:** Medium — trust-building differentiator.

### tmux Integration (v1.3)
Native tmux support with AI awareness across panes and sessions.

**What tmux is:** A terminal multiplexer that lets you split terminals into panes, create persistent sessions that survive disconnects, and manage multiple terminal windows from a single connection. Essential for remote server work.

**What "native support" means:**
- [ ] HELM renders tmux panes natively (not just passing through raw escape codes)
- [ ] Visual tmux pane management (split, resize, navigate) with mouse and keyboard
- [ ] Status bar integration showing tmux session info
- [ ] tmux sessions persist independently of HELM (attach/detach)

**What "AI awareness" means:**
- [ ] Each tmux pane's commands are captured in session history
- [ ] AI understands multi-pane context ("the error in pane 2 relates to what you ran in pane 1")
- [ ] CLI conversation tracking works inside tmux sessions
- [ ] Explain pane can reference output from any tmux pane
- [ ] Smart pane suggestions ("run tests in pane 2 while you edit in pane 1")

**Why this matters:**
- tmux is essential for power users (DevOps, SREs, backend engineers)
- **Warp explicitly does not support tmux** — their #1 GitHub complaint with hundreds of upvotes
- Developers who SSH into servers and use tmux for persistent sessions cannot use Warp at all
- Supporting tmux captures an entire user segment that Warp cannot serve
- Adding AI awareness on top makes HELM the only terminal that understands multiplexed workflows

**Impact:** High — captures power user segment, major competitive differentiator vs. Warp.

### Mobile Terminal Access (v1.3)
Access and interact with your HELM terminal sessions from any mobile device on the same network or VPN. Your session follows you — no laptop required.

**How it works:**
HELM desktop runs a lightweight WebSocket server on a configurable port. A mobile client (PWA or native app) connects over LAN or VPN, authenticates, and presents your active terminal sessions in a touch-optimized interface. This is not SSH to a remote server — it's direct access to your live HELM desktop sessions.

**Core Features:**
- [ ] WebSocket server embedded in HELM desktop (configurable port, disabled by default)
- [ ] Device pairing via QR code scan or 6-digit PIN from desktop
- [ ] TLS encryption for all traffic between devices (self-signed cert generated on first use)
- [ ] View all open tabs and active sessions from mobile
- [ ] Read terminal output in real-time (streamed, not polled)
- [ ] Send commands from mobile with a touch-optimized input bar
- [ ] Common command shortcuts / quick-action buttons (Ctrl+C, arrow keys, Tab, etc.)
- [ ] Session history browsing from mobile (read-only view of past sessions)

**Authentication & Security:**
- [ ] First-connect pairing (QR code or PIN) — device is remembered after initial pairing
- [ ] Paired device management (view, rename, revoke from desktop)
- [ ] Optional session-level permissions (read-only vs. interactive per paired device)
- [ ] Auto-disconnect after configurable idle timeout
- [ ] All traffic encrypted via TLS — no plaintext commands over the network
- [ ] Connection limited to LAN/VPN by default (no internet exposure unless user explicitly configures port forwarding)

**Mobile UX:**
- [ ] Touch-optimized terminal renderer (larger tap targets, pinch-to-zoom, horizontal scroll)
- [ ] Swipe between tabs/sessions
- [ ] Smart keyboard with common CLI keys (Tab, Ctrl, Esc, pipe, arrow keys) above the standard keyboard
- [ ] Notification support — alert on long-running command completion ("npm build finished")
- [ ] Quick actions: copy last output, re-run last command, send Ctrl+C
- [ ] Dark/light theme matching desktop preference

**Progressive Web App (PWA) — Phase 1:**
- [ ] Ship as PWA first — no app store approval needed, works on iOS and Android immediately
- [ ] Add to Home Screen support for app-like experience
- [ ] Service worker for offline access to session history (read-only)
- [ ] Responsive layout optimized for phone and tablet

**Native App — Phase 2 (v1.5+):**
- [ ] React Native app for iOS and Android
- [ ] Push notifications for command completion and error alerts
- [ ] Background connection persistence
- [ ] Biometric auth (Face ID / fingerprint) to unlock paired sessions
- [ ] Widget support (iOS/Android) — glanceable view of running processes

**Why this matters:**
- **No terminal offers this.** Termius ($10/mo) does SSH to remote servers — it doesn't let you interact with your local desktop terminal sessions from your phone
- Developers frequently step away from their desk while builds, deployments, or tests are running — checking status currently requires going back to the laptop
- DevOps/SRE users monitoring long-running processes (migrations, data jobs) get real value from mobile access
- Combined with HELM's session persistence and command blocks, the mobile view is immediately useful — not just a raw shell, but structured, readable output
- Positions HELM as a cross-device terminal experience, not just a desktop app

**Impact:** High — unique differentiator with no direct competition. Moves HELM from "terminal app" to "terminal platform."

---

## Phase 2: AI Power Features (v1.4 - v1.6)

**Goal:** Make HELM the smartest terminal. AI that understands your work, not just your commands.
**Timeline:** Q3 2026

### Semantic Output Understanding (v1.4)
AI that parses build errors, test failures, and log output — suggests fixes automatically.

- [ ] Detect error patterns in command output (build failures, test errors, stack traces)
- [ ] Inline "Fix this" button on detected errors
- [ ] AI explains the error and suggests a command to fix it
- [ ] Works with common tools: npm, cargo, go, pytest, jest, webpack, docker
- [ ] Learn from user's fix patterns over time

**Why:** No terminal does semantic output analysis. Developers spend significant time parsing error output.

### Workflow Recording & Replay (v1.4)
Record multi-step terminal processes. AI parameterizes them into reusable, shareable workflows.

- [ ] Start recording → execute commands → stop recording
- [ ] AI analyzes the sequence and identifies parameters (paths, names, versions)
- [ ] Generates a parameterized workflow with descriptions
- [ ] Run workflows with different parameters
- [ ] Share workflows with team or community
- [ ] Version workflows (track changes over time)

**Why:** Warp has manual workflows. Auto-recording and AI parameterization is new.

### Environment Doctor (v1.5)
AI that detects and fixes environment issues automatically.

- [ ] Detect wrong language versions (Python 3.8 vs 3.12, Node 16 vs 20)
- [ ] Find missing environment variables before commands fail
- [ ] Identify stale caches, corrupt node_modules, lock file conflicts
- [ ] Suggest and execute fixes
- [ ] Pre-flight checks before running commands

**Why:** "It works on my machine" is a universal pain point. No tool proactively diagnoses environment issues.

### Cross-CLI Conversation Memory (v1.5)
HELM remembers what you discussed in Claude Code across sessions and makes it useful.

- [ ] "What did I ask Claude about the auth module last week?" → instant answer
- [ ] AI references previous CLI conversations when explaining new commands
- [ ] Personal knowledge graph from CLI interactions
- [ ] Surface relevant past conversations when working in similar code

**Why:** We already capture CLI conversations — this makes the data a competitive moat.

### BYOK Support (v1.6)
Let users bring their own API keys for all AI features.

- [ ] Configure OpenAI, Anthropic, Google, or local model endpoints
- [ ] Per-feature model selection (GPT-4o for chat, Claude for explain)
- [ ] Usage tracking and cost estimation
- [ ] No HELM account required for BYOK users
- [ ] Model comparison ("try this explanation with Claude vs GPT")

**Why:** Table stakes. Wave and Warp both support it.

---

## Phase 3: Team & Platform (v1.7 - v2.0)

**Goal:** Expand from individual tool to team platform. Drive revenue growth.
**Timeline:** Q4 2026 - Q1 2027

### Team Workspaces (v1.7)
- [ ] Shared workspace with team command library
- [ ] Push sessions/workflows to team workspace
- [ ] Role-based access (admin, editor, viewer)
- [ ] Activity feed showing team terminal activity
- [ ] Onboarding workflows for new team members

### Collaborative Terminal (v1.8)
- [ ] Invite team members to terminal session (read-only or interactive)
- [ ] AI mediator ("User A is about to run a destructive command")
- [ ] Pair programming in the terminal
- [ ] Session recording with playback for async review

### SSH Manager (v1.8)
- [ ] Saved SSH profiles with encrypted credentials
- [ ] Durable sessions that survive disconnects (auto-reconnect)
- [ ] AI understands remote environment (different OS, tools)
- [ ] Jump host / bastion support
- [ ] File transfer integration

### Plugin/Extension API (v1.9)
- [ ] JavaScript/TypeScript plugin API
- [ ] Hooks for terminal events (command executed, output received, error detected)
- [ ] Custom pane/widget system
- [ ] Plugin marketplace
- [ ] Official plugins: GitHub, Jira, Slack, Docker, Kubernetes

### MCP Server (v1.9)
- [ ] Expose terminal state, session history, and commands via Model Context Protocol
- [ ] AI assistants (Cursor, Windsurf, Claude) can read terminal context
- [ ] Bidirectional: AI tools can send commands to HELM

### Cross-Platform (v2.0)
- [ ] Windows: PowerShell, CMD, WSL integration
- [ ] Linux: .deb, .rpm, AppImage, Snap
- [ ] Consistent feature set across platforms

---

## Phase 4: Enterprise (v2.1+)

**Goal:** Enterprise revenue. Large team deployments.
**Timeline:** Q2 2027+

| Feature | Description |
|---------|------------|
| SSO/SAML | Enterprise identity provider integration |
| Zero Data Retention | No terminal data stored on HELM servers |
| Audit Logs | Full audit trail for compliance |
| Centralized Config | IT admin controls for all users |
| On-prem AI | Air-gapped AI deployment |
| Custom Model Support | Enterprise fine-tuned models |
| Compliance Reporting | SOC 2, HIPAA, FedRAMP alignment |
| Priority Support | Dedicated support channel, SLAs |

---

## Pricing Strategy

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0/mo | 10 AI calls/mo, Chat & Explain modes, GPT-4o-mini, usage dashboard |
| **BYOK** | $5.99/mo ($2.99 launch) | Unlimited AI calls, use your own API key, all modes (Chat, Explain, Suggest), any OpenAI/Anthropic model |
| **Basic** | $9.99/mo | 500 AI calls/mo, all modes (Chat, Explain, Suggest), GPT-4o included, usage dashboard, priority support, Command Blocks, Smart Autocomplete, Session Search, Mobile Terminal Access (PWA) |
| **Pro** | $12.99/mo | 2,000 AI calls/mo, all modes + priority queue, GPT-4o + Claude included, advanced usage analytics, priority support, workflows, cross-CLI memory |
| **Team** | $25/user/mo | Everything in Pro + shared workspaces, collaborative terminals, SSH manager, admin controls |
| **Enterprise** | Custom | Everything in Team + SSO, ZDR, audit logs, on-prem AI, dedicated support |

### Pricing Principles
1. **No mandatory login for free tier** — terminal features always work without an account
2. **BYOK as its own tier** — $5.99/mo (launch: $2.99) for users who bring their own keys and want unlimited AI with any model
3. **Basic is the popular tier** — $9.99/mo gets Phase 1 features (Command Blocks, Autocomplete, Session Search, Mobile Access) + 500 AI calls with GPT-4o
4. **Transparent limits** — no opaque credits, clear call counts per tier
5. **Price below Warp ($20) and Cursor ($20)** — Pro at $12.99/mo attracts switchers
6. **Team tier below Cursor Teams ($40) and Warp Business ($50)**

---

## Success Metrics

| Phase | Key Metrics |
|-------|------------|
| Phase 1 | DAU, session length, 7d/30d retention, commands/session |
| Phase 2 | AI feature usage rate, workflow creation, CLI capture volume, free→Pro conversion |
| Phase 3 | Teams created, team size growth, collaborative session frequency, Pro→Team upgrade |
| Phase 4 | Enterprise pipeline, ACV, net revenue retention, Fortune 500 logos |

---

## Technical Debt / Ongoing

- [ ] Replace PostgreSQL with SQLite for easier distribution (no external dependency)
- [ ] Add automated tests (unit + integration)
- [ ] CI/CD pipeline for builds and releases
- [ ] Code signing for macOS (notarization)
- [ ] Auto-update mechanism (electron-updater)
- [ ] Performance profiling (memory leaks, PTY cleanup)
- [ ] Security audit (API key storage, CSP headers)
- [ ] Expand CLI watcher to support Codex, Aider, and other tools' conversation files

---

## Key Risks

| Risk | Mitigation |
|------|-----------|
| Warp adds tmux support | Ship tmux first, build deeper integration |
| Claude Code / Codex change file formats | Abstract the watcher layer, support multiple formats |
| Electron performance at scale | Profile and optimize; consider Tauri for v3.0 |
| AI cost pressure on free tier | BYOK offloads cost; local model support |
| Enterprise sales cycle length | Self-serve Pro/Team tiers fund development |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tab Bar                          │
│  [Terminal 1] [Terminal 2] [+]  | [Chat] [SB] [⚙]  │
├─────────────────────────────────────────────────────┤
│  [📁]  ~/Documents/projects                   [Go] │
├──────────┬──────────────────────┬───────────────────┤
│          │                      │                   │
│  Chat    │     Terminal         │    Sidebar        │
│  Panel   │     (xterm.js)       │    History /      │
│          │                      │    Explain /      │
│  AI Chat │     node-pty         │    Sessions       │
│  with    │     Real shell       │                   │
│  code    │                      │    CLI convo      │
│  inject  │     CLI Watcher      │    tracking       │
│          │     (file-based)     │                   │
├──────────┤                      ├───────────────────┤
│ [input]  │                      │                   │
└──────────┴──────────────────────┴───────────────────┘

AI Service Layer:
  ├── OpenAI    (GPT-4o)
  ├── Anthropic (Claude)
  ├── llama.cpp (local)
  └── HELM Proxy (backend)

CLI Conversation Capture:
  ├── Claude Code  (~/.claude/ conversation files)
  ├── Codex        (planned)
  ├── Aider        (planned)
  └── Generic      (PTY output parsing fallback)
```

---

## Appendix: Competitor Detail

### Warp ($0-50/mo)
- **Strengths:** Command Blocks, Workflows, AI Agents (Oz), polished UI, cross-platform
- **Weaknesses:** Mandatory login, no tmux, pricing changes, telemetry concerns
- **Users love:** Blocks paradigm, modern UI, AI suggestions
- **Users hate:** Account requirement, no tmux, "Warping" hangs

### Wave Terminal (Free/OSS)
- **Strengths:** Graphical widgets, zero-account, BYOK, durable SSH, inline previews
- **Weaknesses:** New/immature, small community, performance with many widgets
- **Users love:** No account, graphical widgets, privacy
- **Users hate:** Learning curve, performance issues

### iTerm2 (Free/OSS)
- **Strengths:** Rock-solid, privacy-first AI plugin, tmux, Python scripting API
- **Weaknesses:** macOS only, dated UI, basic AI
- **Users love:** Reliability, no vendor lock-in, tmux, customization
- **Users hate:** macOS only, basic AI, configuration complexity

### Tabby (Free/OSS)
- **Strengths:** Built-in SSH client, cross-platform, serial terminal, MCP, plugins
- **Weaknesses:** Heavy (Electron), input lag, no native AI
- **Users love:** SSH management, modern UI, serial support
- **Users hate:** Resource usage, performance, scrolling lag

### Cursor ($20-200/mo)
- **Strengths:** Agent mode, Tab completions, Auto mode, VS Code familiarity
- **Weaknesses:** Silent code reversion, AI ignores instructions, security vulnerabilities
- **Users love:** Tab completions, agent mode, familiar interface
- **Users hate:** Code bugs, overcharges, poor support

### Windsurf ($15-200/mo)
- **Strengths:** Cascade agent, Memories, proprietary SWE models, 1M+ users
- **Weaknesses:** 21+ outages in 4 months, credit issues, context loss
- **Users love:** Cascade, Memories, generous free tier
- **Users hate:** Reliability, credits vanishing, slow support

### Amazon Q / Kiro CLI ($0-19/mo)
- **Strengths:** Works in existing terminal, 500+ CLI autocomplete, AWS integration
- **Weaknesses:** AWS-centric, confusing branding, limited free tier
- **Users love:** No terminal replacement, autocomplete, free tier
- **Users hate:** AWS lock-in, branding confusion
