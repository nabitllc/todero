# Todero — Machine Migration Guide

How to move Todero from one machine to another (or add a new dev machine).
Written 2026-04-15 after the Mac Mini → laptop + Vercel migration planning.

---

## Architecture overview

| Layer | Where it lives | Portable? |
|---|---|---|
| Web app (Next.js UI + API) | **Vercel** (deploy once, works everywhere) | ✅ yes |
| Database | **Supabase** (remote, accessed via URL+key) | ✅ yes |
| All code + config | **GitHub** (`nabitllc/todero`) | ✅ yes |
| LaunchAgent plists | `config/launchagents/` in git (with placeholders) | ✅ yes (bootstrap.sh installs) |
| Telegram bot + agent spawner | **Mac Mini** (always-on, keeps running) | ✅ stays put |
| `.env.local` | Email/1Password to yourself — see template | ⚠️ manual copy |
| Claude Code CLI auth | Re-authenticate on new machine | ⚠️ one-time setup |

**Key insight:** The Mac Mini stays on and keeps running the Telegram bot and agent spawner. You don't need to migrate those — just set up a new machine for development and Vercel for the public web UI.

---

## What you need before starting

- [ ] `.env.local` file (copy from Mac Mini or retrieve from 1Password)
- [ ] Access to [github.com/nabitllc/todero](https://github.com/nabitllc/todero)
- [ ] Claude Desktop installed on new machine (includes Claude Code CLI)
- [ ] Vercel account (`$20/month Pro`) — [vercel.com](https://vercel.com)

---

## Phase 0 — Fix Supabase egress first (if not already done)

> **Skip if you're on commit `24555c4` or later** — this is already fixed.

The free Supabase tier hits its 5GB/month bandwidth limit due to aggressive UI polling.
The fix (committed 2026-04-15): `GET /api/issues` now selects specific columns instead of `SELECT *`, and polling intervals were raised.

Check Supabase usage at: https://app.supabase.com → your project → Usage tab.
If the project is paused due to egress: hit "Restore project", then deploy the fix.

---

## Phase 1 — Deploy to Vercel (30 min)

This gives you a public URL accessible from any machine — no cloudflared tunnel needed.

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import `nabitllc/todero` from GitHub
2. In **Environment Variables**, add every key from `.env.local` (copy-paste each one)
   - Also add: `NEXT_PUBLIC_APP_URL=https://your-project.vercel.app`
   - Also add: `CRON_SECRET=<any random string>` (protects cron routes from external calls)
3. Click **Deploy** — Vercel detects Next.js automatically, no config needed
4. Visit the Vercel URL — confirm the board loads and data appears
5. **Prevent agent commits from triggering builds:**
   - Vercel dashboard → Settings → Git → **Ignored Build Step**
   - Command: `[[ "$VERCEL_GIT_COMMIT_MESSAGE" == *"[skip ci]"* ]] && exit 0 || exit 1`
   - This prevents Builder's 30-40 daily commits from consuming your 6,000 build minutes/month

6. **Verify Vercel Crons are active:**
   - Vercel dashboard → your project → **Crons** tab
   - You should see three cron jobs (from `vercel.json`):
     - `/api/cron/watchdog` — every 30 min
     - `/api/cron/sprint-cycle` — 6:55am ET daily
     - `/api/cron/pr-window` — 7am + 7pm ET daily
   - These are additive — the Mac Mini LaunchAgents keep running too

---

## Phase 2 — Set up new laptop for development (20 min)

**Works on Mac or Windows (Windows requires WSL for agent spawning — see note below).**

### Mac laptop

```bash
# 1. Install Node.js via Homebrew
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 2. Clone the repo
git clone https://github.com/nabitllc/todero.git ~/todero
cd ~/todero

# 3. Copy .env.local (email it to yourself, then)
cp ~/Downloads/.env.local .

# 4. Install dependencies and build
npm install
npm run build

# 5. Run locally (for development)
npm run dev
# → http://localhost:3000
```

Claude Code CLI comes with Claude Desktop — already installed. Sign in with your Anthropic account.

### Windows laptop

```powershell
# 1. Install Node.js — download from https://nodejs.org (LTS version)
#    Run the .msi installer. Select "Add to PATH" during install.

# 2. Clone the repo (Git Bash or PowerShell)
git clone https://github.com/nabitllc/todero.git C:\todero
cd C:\todero

# 3. Copy .env.local into C:\todero\

# 4. Install and build
npm install
npm run build

# 5. Run for development
npm run dev
```

> **Windows note on agent spawning:** The agent runtime (`lib/runtimes/claude-code.ts`) uses
> `bash`, `nohup`, and Unix process management. On Windows, Claude Code CLI must run inside
> **WSL** (Windows Subsystem for Linux) for agent spawning to work. For UI/development only,
> WSL is not required — just use the Vercel URL or `npm run dev`.

---

## Phase 3 — Set up LaunchAgents on a new Mac (10 min)

> **Skip for Windows** (no LaunchAgents on Windows). The Mac Mini already handles all automation.
> Only needed if setting up a *second* Mac that should run the watchdog/Telegram bot.

```bash
cd ~/todero

# Install all LaunchAgents (replaces __HOME__, __TODERO_DIR__ placeholders with real paths)
bash config/launchagents/bootstrap.sh
```

The script will:
- Detect your home dir, Homebrew prefix, and claude binary location
- Substitute placeholders in each plist template
- Copy to `~/Library/LaunchAgents/`
- Load each one with `launchctl`
- Ask before installing cloudflared (skip if using Vercel instead)

**Verify everything started:**
```bash
tail -f /tmp/todero.log           # Next.js server
tail -f /tmp/agent-kicker.log     # Pipeline watchdog
tail -f ~/todero/config/logs/telegram-kaos.out.log  # Telegram bot
```

---

## Phase 4 — Cutover (5 min, when ready)

Only needed if you're *replacing* the Mac Mini rather than keeping it running.

```bash
# On Mac Mini — unload all LaunchAgents
for plist in ~/Library/LaunchAgents/work.nabit.*.plist; do
  launchctl unload "$plist"
done

# Verify on new machine:
# - Vercel URL is serving traffic
# - Telegram bot is responding
# - Watchdog fired at the next 30-min mark (check /tmp/agent-kicker.log)
```

---

## Checklist — new machine working when:

- [ ] `https://your-project.vercel.app` loads the board with real data
- [ ] Telegram bot responds to a test message
- [ ] Vercel Crons tab shows last run time (after first 30-min mark)
- [ ] `npm run dev` works on laptop at localhost:3000
- [ ] Builder can be kicked and completes a task end-to-end

---

## Machine-local things that don't transfer automatically

| Item | Action |
|---|---|
| `~/.claude/` session files | Start fresh sessions — conversations reset but nothing breaks |
| `~/agent-worktrees/` | Ignore — ephemeral, created fresh per agent run |
| `~/.cloudflared/` config | Only needed if keeping cloudflared; skip if using Vercel |
| Claude Code CLI OAuth token | Re-authenticate: `claude` → follow login prompt |

---

## Env vars reference

All required keys are documented in `.env.local.template` at the repo root.
Where to find each one:
- **Supabase**: https://app.supabase.com → project → Settings → API
- **Anthropic**: https://console.anthropic.com → API Keys
- **Telegram**: https://t.me/BotFather → your bot
- **Discord**: https://discord.com/developers/applications → your app → Bot
- **GitHub PAT**: https://github.com/settings/tokens → classic, repo scope

---

## Pending work (tracked issues)

| Issue | What |
|---|---|
| TOD-1512 | Replace OfficeCanvas polling with Supabase Realtime subscriptions (event-driven updates) |
| TOD-XXX | Implement full sprint-cycle + PR window logic in `/api/cron/` routes (for when Mac Mini retires) |
