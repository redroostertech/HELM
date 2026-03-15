# HELM — Product Roadmap

**Vision:** Cursor for the terminal. AI-powered, works offline, teaches as you go.

**Powered by:** LANA AI
**Company:** RedRooster Technologies Inc.
**Last Updated:** March 15, 2026

---

## Phase 1: Foundation (Complete)

- [x] Electron + React + TypeScript + Vite
- [x] xterm.js terminal with node-pty
- [x] PostgreSQL command history with grouping and deduplication
- [x] Browser-like address bar with real directory autocomplete
- [x] Multi-tab terminal support (up to 7 tabs)
- [x] Tab persistence across refreshes
- [x] Per-tab memory usage tracking
- [x] Auto-generated tab descriptions from recent commands
- [x] Collapsible sidebar (History + Explain panels)
- [x] Collapsible AI chat panel with conversation history
- [x] AI-powered command explanation (click any command to explain)
- [x] Code block injection from chat into terminal ("Run" button)
- [x] Settings panel (full-screen, clean UI)
- [x] OpenAI + Anthropic API integration (swappable providers)
- [x] Dark and light theme support
- [x] Helvetica Neue typography
- [x] Panel toggle controls in tab bar (Cursor-style layout)
- [x] Confirmation modals for destructive actions
- [x] ANSI escape code filtering in command capture
- [x] zsh session noise suppression

---

## Phase 2: Release Prep (Current)

**Goal:** Ship v1.0 with OpenAI as the default AI provider.

- [ ] Onboarding flow — prompt for OpenAI API key on first launch
- [ ] Clear old ANSI garbage from existing history (migration)
- [ ] Fix address bar navigation to update terminal working directory display
- [ ] Polish terminal resize behavior when toggling panels
- [ ] Error handling for API failures (graceful messages, retry)
- [ ] Keyboard shortcuts (Cmd+T new tab, Cmd+W close tab, Cmd+1-7 switch tabs)
- [ ] Package as macOS .dmg with electron-builder
- [ ] App icon and branding
- [ ] Landing page and distribution (website, GitHub release)
- [ ] README rewrite for HELM branding

---

## Phase 3: Local AI (llama.cpp)

**Goal:** Bundle a local LLM so the app works offline with zero config.

- [ ] Integrate llama.cpp as a native binary (compiled for macOS arm64 + x86_64)
- [ ] Ship with Qwen 2.5 Coder 1.5B (GGUF quantized, ~1.5GB)
- [ ] Create `LlamaCppService` implementing the `AIService` interface
- [ ] Auto-download model on first launch (or bundle in .dmg)
- [ ] Settings toggle: Local model vs OpenAI vs Anthropic
- [ ] Streaming responses from local model
- [ ] Benchmark: measure latency for command explanations (target <2s)
- [ ] Fallback: if local model fails, suggest switching to OpenAI

---

## Phase 4: Learning Features

**Goal:** Turn command history into structured learning.

- [ ] Session replay — step through commands with explanations
- [ ] Bookmark improvements — tags, search, folders
- [ ] Lesson library — pre-built tutorials (git basics, docker, etc.)
- [ ] "What did I just do?" — summarize last N commands into a narrative
- [ ] Command pattern detection — "you run this a lot, here's an alias"
- [ ] Progress tracking — commands learned vs. new

---

## Phase 5: Project Mode

**Goal:** Guided workflows for building real projects.

- [ ] Guided workflows ("Build a React app from scratch")
- [ ] Step-by-step checkpoints with validation
- [ ] Fork/branch different approaches
- [ ] Community-contributed tutorials
- [ ] Project templates

---

## Phase 6: Monetization

**Goal:** Sustainable business model.

### Pricing Tiers

| Tier | Features | Price |
|------|----------|-------|
| **Free** | Local llama.cpp model, single tab, basic chat, command history | $0 |
| **Pro** | Multi-tab, OpenAI/Anthropic integration, chat history, session replay, lessons | $12/mo |
| **Team** | Shared command libraries, team lessons, centralized config, SSO | $20/seat/mo |

### Revenue Streams

- [ ] Pro subscriptions (individual developers)
- [ ] Team licenses (dev teams, bootcamps, universities)
- [ ] Proxied API calls (margin on OpenAI/Anthropic usage for users without keys)
- [ ] Marketplace for community lessons/tutorials
- [ ] Enterprise: on-prem deployment with custom models

---

## Phase 7: Platform Expansion

- [ ] Linux support (.AppImage, .deb)
- [ ] Windows support (.exe, Microsoft Store)
- [ ] SSH remote terminal sessions
- [ ] Split pane terminals (horizontal/vertical)
- [ ] Plugin system for custom tools
- [ ] VS Code extension (embedded HELM panel)

---

## Technical Debt / Ongoing

- [ ] Replace PostgreSQL with SQLite for easier distribution (no external dependency)
- [ ] Add automated tests (unit + integration)
- [ ] CI/CD pipeline for builds and releases
- [ ] Code signing for macOS (notarization)
- [ ] Auto-update mechanism (electron-updater)
- [ ] Performance profiling (memory leaks, PTY cleanup)
- [ ] Security audit (API key storage, CSP headers)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tab Bar                          │
│  [Terminal 1] [Terminal 2] [+]  | [Chat] [SB] [⚙]  │
├─────────────────────────────────────────────────────┤
│  [📁 icon]  ~/Documents/projects              [Go] │
├──────────┬──────────────────────┬───────────────────┤
│          │                      │                   │
│  Chat    │     Terminal         │    Sidebar        │
│  Panel   │     (xterm.js)       │    History /      │
│          │                      │    Explain        │
│  AI Chat │     node-pty         │                   │
│  with    │     Real shell       │    Command        │
│  code    │                      │    cards with     │
│  inject  │                      │    grouping       │
│          │                      │                   │
├──────────┤                      ├───────────────────┤
│ [input]  │                      │                   │
└──────────┴──────────────────────┴───────────────────┘

AI Service Layer (Powered by LANA AI):
  ├── OpenAI    (GPT-4o)        ← v1.0 release
  ├── Anthropic (Claude)        ← v1.0 release
  └── llama.cpp (local)         ← v2.0 release
```

---

## Competitive Positioning

| Feature | iTerm2 | Warp | Cursor | HELM |
|---------|--------|------|--------|------|
| AI chat | No | Yes | Yes | Yes |
| Command explanation | No | Partial | No | Yes |
| Inject commands from chat | No | No | No | Yes |
| Works offline (local AI) | N/A | No | No | Yes (v2) |
| Learning/tutorials | No | No | No | Yes |
| Free tier | Yes | Yes | No | Yes |
| Open source | No | No | No | TBD |

**Tagline:** The terminal is not obsolete. It's undertaught. Let's fix that.
