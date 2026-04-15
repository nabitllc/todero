# Todero — Machine Migration Guide

> **Your setup:** Mac Mini (agent runner, always-on) + Windows laptop (development) + Vercel (public web app)

---

## How everything connects

```
MAC MINI (always on, no screen needed)
  • Telegram bot ←→ your phone
  • Builder/PO/Tester/etc. agents (Claude Code CLI — NOT Claude Code Desktop)
  • Watchdog: kicks idle agents every 30 min
  • PR window: merges branches at 7am/7pm
  • Sprint cycle: closes/opens sprints daily
  All of this runs whether your laptop is on or off.
        ↕ reads/writes
SUPABASE (cloud database — all issues, pipeline state, agent runs)
        ↕ reads same data
VERCEL (todero.vercel.app — the board UI, accessible from any browser)
        ↕ you open in browser / push code via git
YOUR WINDOWS LAPTOP
  • Browser → todero.vercel.app   (to see the board)
  • Claude Code Desktop → C:\todero   (to write code)
  • Git push → GitHub → Vercel auto-deploys
```

**Important distinction:**
- **Claude Code Desktop** (your laptop) = a GUI you use to write code with Claude's help
- **Claude Code CLI** (Mac Mini) = a headless command-line program the agents use autonomously

These are completely separate. Agents on Mac Mini never touch Claude Code Desktop.

---

## Migration status

| Phase | Status | Who does it |
|---|---|---|
| Phase 0 — Supabase egress fix | ✅ Done | — |
| Phase 1 — Deploy to Vercel | ✅ Done | — |
| **Phase 2 — Windows laptop setup** | **⏳ Do this now** | **You** |
| Phase 3 — LaunchAgents | ✅ Skip | Mac Mini already running |
| Phase 4 — Cutover | ✅ Skip | Mac Mini stays on |
| Cloudflared tunnel | ✅ Stopped | Done 2026-04-15 |

---

## Phase 2 — Windows laptop setup ← YOU ARE HERE

### Step 1 — Install Node.js
Download from [nodejs.org](https://nodejs.org) → LTS version → run the `.msi` installer.
During install: check **"Add to PATH"**. Restart any open terminals after.

Verify: open PowerShell → `node --version` → should print `v22.x.x`

### Step 2 — Install Git
Download from [git-scm.com](https://git-scm.com) if not already installed.
Verify: `git --version`

### Step 3 — Clone the repo
Open PowerShell:
```powershell
git clone https://github.com/nabitllc/todero.git C:\todero
cd C:\todero
```

### Step 4 — Create .env.local
1. Open Notepad
2. Paste the env var contents from your email
3. **File → Save As** → navigate to `C:\todero`
4. File name: `.env.local`
5. Save as type: **All Files (\*.\*)** ← critical, prevents saving as `.env.local.txt`

### Step 5 — Install dependencies
```powershell
cd C:\todero
npm install
```

### Step 6 — Verify it works
```powershell
npm run build
```
Should complete with no errors.

### Step 7 — Open in Claude Code Desktop
- Open Claude Code Desktop
- Open folder: `C:\todero`
- You're ready to write code

---

## How you work day-to-day from the laptop

**To see the board:** open `todero.vercel.app` in your browser. No laptop setup needed — works from anywhere.

**To write code:**
1. Open `C:\todero` in Claude Code Desktop
2. Make changes with Claude's help
3. Push to GitHub — Vercel deploys automatically

**To see automations working:** just watch the board. Agents run on Mac Mini on their own schedule. Sprint closes/opens happen automatically. You don't need to do anything.

**You never need to run the server locally.** `npm run dev` is only needed if you're developing and want to test changes before pushing. For everything else, use `todero.vercel.app`.

---

## What's still pending (future work, not blocking you)

These are improvements to make the system fully cloud-native. Mac Mini handles them fine for now.

| Item | What | Tracked |
|---|---|---|
| Full Vercel cron routes | `sprint-cycle` and `pr-window` are stubs — Mac Mini LaunchAgents do the real work | TOD-XXX |
| Agent spawning via Vercel | Vercel Cron can't spawn Claude Code CLI — Mac Mini watchdog handles this | TOD-XXX |
| Event-driven OfficeCanvas | Replace remaining polling with Supabase Realtime | TOD-1512 |

None of these block you from using Todero from your laptop right now.

---

## Env vars reference

All keys are in `.env.local.template` at the repo root.

| Key | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | supabase.com → project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | same |
| `MC_PASSWORD` | already in your .env.local |
| `MC_VIEWER_PASSWORD` | already in your .env.local |
| `DISCORD_BOT_TOKEN` | discord.com/developers |
| `TELEGRAM_BOT_TOKEN` | t.me/BotFather |
| `TELEGRAM_GROUP_CHAT` | already in your .env.local |
| `TELEGRAM_DM_CHAT` | already in your .env.local |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `NEXT_PUBLIC_APP_URL` | your Vercel project URL |
| `CRON_SECRET` | any random string (you created this) |
