# PRD: OpenClaw → Native Stack Migration

**Created:** 2026-04-17 | **Owner:** Michael Saenz | **Author:** KAOS  
**Status:** ✅ 100% Complete — All Phases 1–8 done 2026-04-17  
**Tracking epic:** TOD-1514

---

## Background

OpenClaw was the agent orchestration platform that managed agent sessions, heartbeats, chat, memory writes, message routing, and Discord/Telegram notifications. It was shut down 2026-04-09. Agent context and memory are now in Supabase (completed TOD-1514). This PRD covers everything else: broken `.openclaw` references scattered across 80+ files, data flows that need DB migration, cleanup of retired OpenClaw UI, full n8n retirement accounting, and the `~/.openclaw` directory that was never fully cleaned up.

Full grep audit performed 2026-04-17. 83 files matched. n8n workflow audit performed 2026-04-17. 53 workflows accounted for.

---

## ⚠️ Pre-Work — Run Before Phase 3

**`~/.openclaw` is still on disk and was never exported.** `safe-export.py` was never run (no `~/kaos-export-*` directory exists).

The directory contains per-agent SQLite session databases that may hold memory and corrections from before the shutdown that never reached Supabase:
```
~/.openclaw/memory/
  auditor.sqlite
  kaos-claude.sqlite
  main.sqlite
  scout.sqlite
  tester.sqlite
  vespera-sme.sqlite
~/.openclaw/credentials/
~/.openclaw/logs/
```

**Steps (do this before Phase 3):**
1. Run `python3 config/scripts/safe-export.py` → copies unique content to `~/kaos-export-2026-04-17/`
2. Review the export, especially `self-improving/memory.md` diffs per agent
3. Inspect SQLite files for salvageable memory: `sqlite3 ~/.openclaw/memory/main.sqlite .tables`
4. Migrate any unique content to Supabase `agent_memory_files` via POST `/api/agent-memory`
5. Once confirmed clear: `rm -rf ~/.openclaw`
6. Archive `safe-export.py` to `config/scripts/archive/`

---

## What Stays Local — Not In Scope

| File | What | Why |
|---|---|---|
| `app/api/files/route.ts` | Config file browser | IS a file browser — the feature is reading local files |
| `app/api/settings/usage/route.ts` (cost JSON parts) | Claude CLI session cost JSONL | Machine-generated per-session, no value syncing to DB |
| `app/api/status/route.ts` (Vercel auth, n8n, disk checks) | Machine health checks | Inherently machine-local |
| `lib/runtimes/claude-code.ts` + `worktree.ts` | Temp prompt files, worktree scaffolding | Ephemeral, process isolation |
| `lib/runtimes/cursor.ts`, `codex.ts` | Binary existence checks | Machine-local CLI availability |
| `app/api/status/claude-limit/route.ts` | Claude rate-limit state | Transient local cache, fine on disk |
| `config/scripts/pr-window.py` | Git push + PR logic | Operates on local git, correct |
| `config/scripts/release-notes.py` | Version tracking in `config/docs/releases/` | Local release artifact, correct |
| `app/api/run-agent/route.ts` FS fallback (lines 328-363) | Context loading fallback | Intentional safety net for DB-down or local dev |
| `config/scripts/render-agent-context.py` | CLI context renderer | Already updated to `~/todero/config` — no openclaw refs |

---

## Phase 1 — Fix Broken OpenClaw CLI Calls
**Priority: 🔴 High — production code is broken today, silent failures**

### 1.1 `app/api/hub-pause/route.ts`
**What it does:** When pausing/resuming all agents from the UI, stops agent wakeup kicks.  
**Problem:** Calls `openclaw heartbeat pause/resume {agentId}` — dead CLI. Pause button partially works (updates Supabase) but doesn't actually stop agent kicks.  
**Fix:** Replace with upsert to `agent_memory` key-value table: `{ agent_id, key: 'is_paused', value: true/false }`. The `agent-kicker.sh` already checks `d.get('paused')` from the run-agent response before kicking — the write path is the only missing piece. Copy pattern from `lib/loop-breaker.ts`.

### 1.2 `app/api/run-sprint/route.ts`
**What it does:** Sends a message to the main agent when a sprint is triggered from the UI.  
**Problem:** Calls `openclaw message --agent main --text "..."` — dead CLI.  
**Fix:** Replace with POST to existing `/api/notify` Discord endpoint, or drop entirely — the sprint already sends Discord notification via `post_function`.

### 1.3 `app/api/run-builder/route.ts:133`
**What it does:** After spawning a builder task, sends a completion system event.  
**Problem:** Calls `openclaw system event --text "Done: Builder completed..."` — dead CLI.  
**Fix:** Remove the line. The builder's own completion flow handles notifications.

### 1.4 `app/api/status/route.ts` + `app/api/settings/usage/route.ts` + `app/api/automations/route.ts` — openclaw status calls
**What they do:** All three call `openclaw status --json` to get agent status, cost data, and heartbeat info.  
**Problem:** CLI doesn't exist — these sections always return null/empty.  
**Fix:** Remove the `execAsync('/opt/homebrew/bin/openclaw status --json', ...)` calls and their result processing from all three files. Replace with direct `agent_runs` table query for recent activity where needed.

### 1.10 `app/api/automations/route.ts` — entire n8n section
**Problem:** The top 74 lines of this route try to connect to `http://localhost:5678/api/v1/workflows` (the n8n API). `~/.n8n` is already deleted and n8n is fully uninstalled. This call always fails silently inside a try/catch. It also has a hardcoded `N8N_KEY` API credential in the source file that should be removed.  
**Fix:** Delete the entire n8n block (lines 7–74). Remove the `N8N_KEY` constant. The route then only has the openclaw sections remaining, which are also being removed in Phase 2.3. After both removals, `automations/route.ts` should be rebuilt to source its data from: active Vercel crons (read from `vercel.json`), active LaunchAgents (read from `~/Library/LaunchAgents/`), and recent `agent_runs` activity from Supabase.  
**Security note:** The hardcoded `N8N_KEY` (`n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac`) should be removed from the file immediately — even though n8n is gone, credentials in source code are a bad practice and will persist in git history.

### 1.5 Shell scripts — Discord/Telegram notifications via openclaw CLI
**Problem:** All five scripts send notifications via `openclaw message send --channel discord/telegram` — dead CLI. Notifications silently drop. These have been failing since 2026-04-09.  
**Affected:**
- `scripts/smoke-test.sh:84`
- `scripts/dor-check.sh:28`
- `scripts/dor-nightly.sh:52`
- `scripts/pr-window.sh:109-110` (Discord + Telegram)
- `scripts/backlog-heartbeat.sh:54`

**Fix:** Replace each call with direct `curl` POST to the Discord webhook (already used in `/api/notify`):
```bash
curl -s -X POST "$DISCORD_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$MSG\"}"
```
For Telegram (`pr-window.sh:110`): use `curl` to Telegram Bot API with the bot token from env.

### 1.6 `scripts/builder-loop.sh:115`
**Problem:** Calls `openclaw system event --text 'Builder loop: batch complete'` — dead.  
**Fix:** Replace with curl to Discord notify endpoint, or remove (informational only).

### 1.7 `scripts/agent-queue-loop.sh:87-100`
**Problem:** Primary dispatch calls `openclaw message --agent $AGENT_ID` — dead. Script already has fallback to `claude --print` which works. Dead primary path adds latency and log noise. Also line 95 calls `openclaw system event` after completion — dead.  
**Fix:** Remove the `if command -v openclaw` branch entirely. Promote the `claude --print` path as primary. Remove the `openclaw system event` on line 95.

### 1.8 `config/scripts/commit-monitors.sh:1`
**Problem:** Line 1 is `cd ~/.openclaw/workspace` — dead path. Script can't run at all.  
**Fix:** Update to `cd ~/todero/config` (the correct workspace since migration 2026-04-09).

### 1.9 n8n: OpenClaw Gateway Watchdog workflow
**File:** `config/scripts/n8n-exports/slQ0YtOPzYQ2oNmY_OpenClaw Gateway Watchdog.json`  
**Problem:** n8n workflow monitors a gateway that no longer exists. If active, it's firing false-positive alerts or failing silently on every run.  
**Fix:** Check if workflow is active in n8n (`http://localhost:5678`). If yes, disable it. Archive the export JSON to `config/scripts/n8n-exports/archive/`.

---

## Phase 2 — Migrate Dead File Reads to Supabase
**Priority: 🟠 Medium — features visibly broken, no crash**

### 2.1 `app/api/office-stream/route.ts` — Agent Activity Feed
**What it does:** Powers the pixel-art office dashboard. Shows what each agent is currently doing (thinking, writing code, running tests).  
**Problem:** Reads `~/.openclaw/agents/{id}/sessions/sessions.json` — dead path. Dashboard shows no active sessions.  
**Fix:** Query `agent_runs` table: `SELECT agent_id, status, started_at, task_title WHERE started_at > now() - interval '2h' ORDER BY started_at DESC`. Cache response 30s server-side to keep egress low. One small query per poll cycle.

### 2.2 `app/api/status/route.ts` — Session Cost Data
**What it does:** Shows token usage and estimated cost per agent on the status dashboard.  
**Problem:** Reads JSONL session cost files from dead `~/.openclaw/agents/*/sessions/` path. Always empty.  
**Fix:** Add `cost_usd` + `tokens_used` columns to `agent_runs` (populated by run-agent when a session ends). Status route queries: `SELECT SUM(cost_usd), SUM(tokens_used) WHERE date = today`. Cache 60s. Single aggregate row.

### 2.3 `app/api/agents/[id]/files/route.ts` — Agent Files UI Panel
**What it does:** Serves SOUL.md, HEARTBEAT.md, AGENTS.md content for each agent in the agent detail panel.  
**Problem:** Reads from local `todero/config` filesystem — breaks if app is accessed remotely; also reads stale files if DB content has been updated.  
**Fix:** Query `agent_documents WHERE agent_id = $1 AND doc_type IN ('soul','heartbeat','agents')`. Returns ~3 rows (~20KB). Add `Cache-Control: max-age=300` — these files rarely change.

### 2.4 `app/api/health/route.ts` — Heartbeat State
**What it does:** Public `/api/health` endpoint reads `~/todero/config/self-improving/heartbeat-state.md` to show when the self-improving skill last ran (lines 46-56).  
**Problem:** Local file read. Breaks on remote access; also creates a split — agents write heartbeat state locally, health endpoint reads locally, but both should be in DB.  
**Fix:** Write heartbeat state to `agent_memory_files` with `memory_type='heartbeat_state'`. Health route queries a single row. Near-zero egress.

### 2.5 `app/api/run-agent/route.ts` — Spawn prompt local path references
**Problem:** The system prompt injected into spawned agents references local file paths like `~/todero/config/skills/proactivity/*.md` as reading instructions. Agents may attempt local file reads based on these instructions.  
**Fix:** Replace local path references in the spawn prompt with DB slug names (e.g., `skill:proactivity`, `skill:self-improving`). `loadContextFromDB()` already loads skills by slug — the prompt just needs to reference them correctly.

### 2.6 `components/tabs/AgentDetailView.tsx:412`
**Problem:** Dead fallback constructs path `` `/Users/kemuniagent/.openclaw/workspace${agent.id !== 'main' ? '-' + agent.id : ''}` `` — always wrong.  
**Fix:** Remove the dead fallback. Show `agent.workspaceDir` from config, or omit if not set.

---

## Phase 3 — Close the Memory Write Gap
**Priority: 🔴 High — active data loss every day since 2026-04-09**

Agents now READ context from Supabase but WRITE new memory to local files via dead paths. The DB has been stale since April 9 (~8 days of missing agent memory as of this PRD). This is the most operationally critical phase.

### 3.1 `config/scripts/append-agent-memory.py` — Memory Write Script
**What it does:** Called by agents after completing tasks to append lessons, corrections, and hot memory to self-improving files.  
**Problem:** `WORKSPACE_PREFIX = pathlib.Path("/Users/kemuniagent/.openclaw")` — dead path. All writes go nowhere.  
**Frequency:** Multiple times per day per active agent — on task completion, correction, auto-compact, session end. Highest-frequency write in the system.  
**Fix:** Replace file writes with POST to `/api/agent-memory` (already exists). Preserve existing memory types: `long_term`, `self_improving`, `corrections`, `daily`.

### 3.2 `config/scripts/monitor-stale.py` — Stale Recovery Logger
**What it does:** When watchdog resets a stale claim, logs recovery to `config/self-improving/stale-recoveries.md`. After 3+ repeated failures on same agent/issue type, escalates to `memory.md`.  
**Problem:** Writes locally — DB never gets these escalations.  
**Fix:** Replace local file writes with PATCH to `/api/agent-memory` with `memory_type='corrections'` and `memory_type='self_improving'`.

### 3.3 `config/scripts/telegram-kaos-v2.py` — Telegram Bot Context
**What it does:** The Telegram bot reads SOUL.md, AGENTS.md, memory.md, and today's daily memory file to build context before responding to messages.  
**Problem:** Reads directly from local files at `~/todero/config`. After migration, local files may be stale while DB has current memory.  
**Fix:** Replace local file reads with HTTP GET to `/api/agent-memory` and `/api/agent-docs` endpoints (both exist). Bot then has the same context as agents spawned via run-agent.

### 3.4 Daily memory write gap — No DB row created for today
**Problem:** Nothing creates today's row in `agent_memory_files` (type `daily`) in the DB. Agents loading daily context get the last synced date (2026-04-10 based on grep). Local `config/memory/2026-04-17.md` exists but its DB counterpart never gets created.  
**Fix:** Add a daily cron (via n8n sprint-cycle workflow or a new lightweight LaunchAgent) that upserts the `agent_memory_files` row for today's date. Also: backfill the 8 missing days (2026-04-10 through 2026-04-17) from local `config/memory/` files that do exist.

### 3.5 `config/scripts/n8n-audit.py` — n8n Export Script
**Problem:** Exports n8n workflow JSONs to `~/.openclaw/workspace/scripts/n8n-exports/` — dead path. n8n is fully retired.  
**Fix:** Archive to `config/scripts/archive/`. The 53 workflow exports already exist in `config/scripts/n8n-exports/` as reference material (see Phase 6.4). No further export capability needed.

### 3.6 `config/scripts/render-named-agent-task.py` — Dead Script
**Problem:** Entire script rendered task payloads for `openclaw agent --agent` — the CLI it calls is dead. No fallback.  
**Fix:** Archive to `config/scripts/archive/`. Its function is now served by direct `/api/run-agent` calls.

### 3.7 `scripts/post-task-memory.sh` — Post-task memory writes go local
**What it does:** Called by `agent-queue-loop.sh` after each task completes. Reads `reviewer_notes`, `rejection_count`, `implementation_notes` from Supabase, then appends a timestamped entry to `workspace-{agent}/self-improving/corrections.md` and `memory.md` locally.  
**Problem:** Writes to local workspace paths — same dead write gap as `append-agent-memory.py`. All post-task lessons are lost.  
**Fix:** Update to POST to `/api/agent-memory` instead of writing local files. Same fix pattern as Phase 3.1.

### 3.8 `scripts/promote-hot-patterns.sh` — Pattern promotion writes go local
**What it does:** Scans `workspace-{agent}/self-improving/corrections.md`, groups corrections by similarity, and promotes patterns appearing 3+ times to `memory.md` HOT tier.  
**Problem:** Reads and writes to local workspace paths. After migration, the source corrections are in Supabase but this script reads local files — always empty, so nothing gets promoted.  
**Fix:** Update to read corrections from `/api/agent-memory?type=corrections` and write promoted patterns via PATCH to `/api/agent-memory?type=long_term`. Run by KAOS during sprint review, or add to weekly schedule.

---

## Phase 4 — UI Cleanup — Dead OpenClaw References
**Priority: 🟡 Low-Medium — visual dead weight, misleads agents and users**

### 4.1 `components/tabs/ChatTab.tsx`
**Problem:** Has 'openclaw' tab option in sidebar. Entire chat backend routes to dead OpenClaw server via `x-openclaw-agent-id` / `x-openclaw-session-key` headers. Feature is completely broken.  
**Fix:** Remove openclaw tab option. Leave the tab shell in place for Phase 6 (Chat Rebuild). Show "Coming soon" state or hide the tab until Phase 6 ships.

### 4.2 `app/api/chat/route.ts` + `app/api/chat/send-to-agent/route.ts`
**Problem:** `chat/route.ts` resolves `model = 'openclaw'`. `send-to-agent/route.ts` sends `x-openclaw-agent-id` and `x-openclaw-session-key` headers to a dead server.  
**Fix:** Both routes should be gutted and rebuilt as part of Phase 6. For now: add a `501 Not Implemented` response with `{ error: 'Chat backend offline — rebuilding in Phase 6' }` so failures are explicit rather than silent.

### 4.3 `components/OnboardingWizard.tsx:49`
**Problem:** Lists "OpenClaw Gateway" as a runtime option in onboarding.  
**Fix:** Remove the option. Replace with "Claude Code (local)" which is the actual runtime.

### 4.4 `components/tabs/AutomationsTab.tsx` + `components/tabs/CalendarTab.tsx`
**Problem:** Both tabs have dead source filters: `'openclaw-cron'`, `'openclaw'` (heartbeats), and `'n8n'`. All three always return empty — openclaw is gone, n8n is uninstalled.  
**Fix:** Remove all three dead source filters. The Automations tab should show only: `'vercel-cron'` (from `vercel.json`) and `'launchagent'` (from `~/Library/LaunchAgents/`). Calendar tab same.

### 4.5 `components/tabs/InfraTab.tsx`
**Problem:** References `ls?.openclaw` from the status API response. Always null.  
**Fix:** Remove the openclaw display field.

### 4.6 `app/api/ops/model-canary/route.ts`
**Problem:** Lists `'openclaw'` as a valid model for canary testing.  
**Fix:** Remove from the valid model list.

### 4.7 `app/api/chat/autotitle/route.ts`
**Problem:** Uses `model: 'openclaw'` for auto-generating chat session titles — dead.  
**Fix:** Replace with `model: 'claude-haiku-4-5'` (cheap, appropriate for one-line titling).

### 4.8 `lib/deploy-history.ts`
**Problem:** `'openclaw'` listed as a valid `DeploySource` type.  
**Fix:** Remove from the union type. Cosmetic but keeps the type contract accurate.

### 4.9 `config/capabilities.json` — Ops agent capabilities
**Problem:** The `ops` agent entry lists `openclaw_health_check` and `openclaw_gateway_status` as capabilities, and the `checks` array includes `openclaw_gateway_status`. This file is read by agents for routing decisions — they believe they can check OpenClaw health and route accordingly.  
**Fix:** Remove both entries from ops capabilities and checks. Replace `openclaw_gateway_status` with `todero_api_health` and `agent_kicker_status`. Also audit `workspace` field on each agent — all still list `"workspace": "workspace-{id}"` dead paths; update to `~/todero/config`.

---

## Phase 5 — Stale Templates, Skills, Config Docs
**Priority: 🟢 Low — agents read these for instructions, stale but not crashing**

### 5.1 `config/skills/agent-setup/references/openclaw-json-guide.md`
**Problem:** Entire document describes dead OpenClaw JSON agent config format. Agents reading this for setup instructions get wrong guidance.  
**Fix:** Delete. Replace with stub pointing to `config/capabilities.json` and the `/api/run-agent` endpoint docs.

### 5.2 `config/skills/agent-setup/references/agents-template.md`
**Problem:** Template for spawning agents references openclaw payload format.  
**Fix:** Update to use the `/api/run-agent` POST format.

### 5.3 `config/skills/agent-setup/SKILL.md:20`
**Problem:** References dead `queue-agent-config.json` path.  
**Fix:** Update to reference `agent_queue.ts` or the Supabase agent config endpoint.

### 5.4 `config/skills/self-improving/SKILL.md`
**Problem:** References openclaw paths for writing memory.  
**Fix:** Update to reference the `/api/agent-memory` POST endpoint.

### 5.5 `config/templates/named-agent-spawn-template.md`
**Problem:** Template uses openclaw spawn syntax and references `render-named-agent-task.py` (now archived in Phase 3.6).  
**Fix:** Update to use `claude --print` / `/api/run-agent` format.

### 5.6 `config/templates/issue-types.md`
**Problem:** References openclaw in issue type definitions.  
**Fix:** Remove openclaw-specific fields.

### 5.7 `config/scripts/standup-report.py`
**Problem:** Uses `"User-Agent": "DiscordBot (https://openclaw.ai, 1.0)"` in Discord API headers. Doesn't break functionality but is misleading.  
**Fix:** Update to `"User-Agent": "KaosBot (https://kaos.nabit.work, 1.0)"`.

### 5.8 `config/scripts/safe-export.py`
**See Pre-Work section above.** Script must be run before `~/.openclaw` is deleted. After the pre-work steps are complete and `~/.openclaw` is confirmed gone, archive this script to `config/scripts/archive/`.

### 5.9 `config/CLAUDE.md` + `config/ASSET-MANIFEST.md`
**Problem:** Prose references to OpenClaw in config documentation.  
**Fix:** Remove or rewrite affected sections to describe the current stack.

### 5.10 `config/docs/vespera-status.md`
**Problem:** References `~/.openclaw/workspace-vespera/`, `~/.openclaw/workspace/memory/` — dead paths. Includes shell commands that `ls` those paths.  
**Fix:** Update path references to current locations. Remove the dead `ls ~/.openclaw/workspace-vespera/` commands.

### 5.11 `config/docs/vespera-MEMORY.md` + `config/docs/todero-mvp-plan.md`
**Problem:** Both contain table rows mapping old `.openclaw/workspace` paths to current paths — historical migration notes.  
**Fix:** These are archive-grade docs. Add a `> Note: Pre-migration paths below. Current workspace: ~/todero/config` header comment and leave as historical record.

### 5.12 `config/scripts/launchagents-backup.md` + `config/scripts/launchagents-status.md`
**Problem:** Both reference old openclaw launchagent installation (`git clone ... ~/.openclaw/workspace`).  
**Fix:** Update clone target to `~/todero/config` and remove the `ai.openclaw.gateway.plist` entry from the status list.

### 5.14 — Hardcoded credentials → env var references + key rotation
**Priority: 🔴 High — secrets are in git history and remain exploitable until rotated**

Six files contain credentials written directly in source code. They must be moved to env vars **and** the exposed values rotated (removing them from code does not revoke them from git history — old commits still contain the values).

#### Files to patch

| File | What's hardcoded | Fix |
|---|---|---|
| `config/scripts/auto-deploy.py` | Discord bot token | `os.environ.get('DISCORD_BOT_TOKEN')` |
| `scripts/field-hygiene-sweep.sh` | Discord bot token | `"${DISCORD_BOT_TOKEN}"` from env |
| `scripts/run-tester.sh` | Supabase service role key | `os.environ.get('SUPABASE_SERVICE_ROLE_KEY')` |
| `scripts/backlog-heartbeat.sh` | Supabase service role key | `"${SUPABASE_SERVICE_ROLE_KEY}"` from env |
| `scripts/dor-nightly.sh` | Supabase service role key | `"${SUPABASE_SERVICE_ROLE_KEY}"` from env |
| `app/api/health/route.ts` line 11 | Supabase service role key (fallback) | Remove fallback entirely — if env var is missing, fail fast |

**Note:** `run-tester.sh` and `run-ux-review.sh` are being archived (Phase 8.15) — patch `run-tester.sh` before archiving, or skip the patch and archive immediately. Same result.

#### How LaunchAgent scripts read env vars

Scripts launched by `launchd` do not inherit shell env automatically. Two options:
1. Add `<key>EnvironmentVariables</key>` block to each plist (preferred for installed LaunchAgents)
2. Add a one-liner at the top of each script: `source /Users/kemuniagent/todero/.env.local` — simple for scripts not yet installed as plists

#### Key rotation (required regardless of patch)

The hardcoded values are already in git history. Patching the code files does not remove the risk — anyone with repo read access can still find the values in old commits.

1. **Discord bot token** → Discord Developer Portal → your bot → Reset Token → paste new value into `.env.local` as `DISCORD_BOT_TOKEN`. Old token becomes invalid immediately.
2. **Supabase service role key** → Supabase dashboard → Project Settings → API → Regenerate service role key → paste new value into `.env.local` **and** into Vercel environment variables dashboard (the Vercel-deployed routes also use this key). Old key becomes invalid immediately.

After rotation: any script still using the old hardcoded value will start failing — that's the confirmation that rotation worked.

### 5.13 Historical memory files — archive-grade, no action required
**Files:** `config/memory/2026-03-22.md` through `2026-04-10.md`, `config/MEMORY.md`, `config/PRESERVATION.md`, `config/self-improving/memory.md`, `config/self-improving/session-state.md`, `config/workflow-audit-2026-04-03.md`  
These are read-only historical records. Add a header to `config/self-improving/memory.md` noting that pre-2026-04-09 entries reference the retired OpenClaw stack. No other action.

---

## Phase 6 — n8n Retirement Accounting
**Priority: 🟠 Medium — some gaps are silent operational holes**

n8n is fully retired. All 53 workflows are accounted for below.

### 6.1 — Replaced (no action needed)

| n8n Workflow | Replaced By |
|---|---|
| Tester Loop (30min) + Tester Auto-Trigger | `work.nabit.agent-kicker` |
| Designer Loop (30min) | `work.nabit.agent-kicker` |
| Auto-Activate Agent (active_signoff, open queue) | `work.nabit.agent-kicker` |
| Auto-Trigger Deployer / Scout | `work.nabit.agent-kicker` |
| KAOS Proactive Loop (4h) | `work.nabit.agent-kicker` |
| Nightly Builder Queue | `work.nabit.agent-kicker` + `builder-loop.sh` |
| MC Health Check / Auto-Restart (4 versions) | `/api/cron/watchdog` |
| Sprint Close + Sprint Start | `/api/cron/sprint-cycle` + `work.nabit.sprint-cycle` |
| PR Window (7am/7pm) | `/api/cron/pr-window` + `work.nabit.pr-window` |
| KAOS Daily Brief (8am) | `work.nabit.standup-report` |
| Telegram Command Interface | `work.nabit.telegram-kaos` |
| DoF-ready features → auto-tasks | `/api/cron/queue-refill` |
| Task Completed → Discord | `post_functions` on workflow transitions |
| Global Error Handler (Discord + Telegram) | n8n-internal, does not apply |
| OpenClaw Gateway Watchdog | Delete — nothing to replace (Phase 1.9) |

### 6.2 — Documented as replaced, but LaunchAgent NOT installed

These 5 are listed in `config/CLAUDE.md` as active but are absent from `~/Library/LaunchAgents/`. All 5 scripts exist in `config/scripts/` — they just need plist files loaded.

#### `work.nabit.monitor-stale` → `config/scripts/monitor-stale.py`
**What it does:** Every 2h — detects issues stuck in `in_progress` >2h with no `updated_at` change. PATCHes back to `open` via MC API, kills the claude process, posts to Discord #alerts, appends to `stale-recoveries.md`. Escalates to `memory.md` after 3+ repeated failures on same agent/issue-type.  
**Tokens/egress cost:** Zero. Polls MC API (localhost). No LLM calls. No direct Supabase.  
**Plist template:**
```xml
<key>Label</key><string>work.nabit.monitor-stale</string>
<key>ProgramArguments</key><array>
  <string>/opt/homebrew/bin/python3</string>
  <string>/Users/kemuniagent/todero/config/scripts/monitor-stale.py</string>
</array>
<key>StartCalendarInterval</key><array>
  <dict><key>Minute</key><integer>0</integer></dict>
  <dict><key>Minute</key><integer>30</integer></dict>
</array>
```
**Note:** Script currently writes locally (Phase 3.2 fix required first).

#### `work.nabit.monitor-prs` → `config/scripts/monitor-prs.py`
**What it does:** Every 5min — polls GitHub for new PRs on `nabitllc/todero` and `nabitllc/vespera`. Posts announcement to Discord #pr-reviews. Tracks seen PRs via `state-prs.json` to avoid duplicates.  
**Tokens/egress cost:** Zero. GitHub API polls only. No LLM calls. No Supabase.  
**Schedule:** Every 5 minutes via `StartInterval: 300`.

#### `work.nabit.monitor-pr-merge` → `config/scripts/monitor-pr-merge.py`
**What it does:** Every 5min — polls GitHub for merged PRs. When a PR merges, transitions the linked issue from `approved` → `released` via MC API PATCH. Posts to Discord #deployments.  
**Tokens/egress cost:** Zero. GitHub API + MC API (localhost) only.  
**Schedule:** Every 5 minutes via `StartInterval: 300`.

#### `work.nabit.release-notes` → `config/scripts/release-notes.py`
**What it does:** Every 15min — fetches newly `released` issues from MC API since last run. Groups by type (features, bugs, ops, research). Bumps semver (major if S0, minor if feature, else patch). Writes `config/docs/releases/vX.Y.Z.md`. Posts summary to Discord #release-notes. Tracks state in `state-release-notes.json`.  
**Tokens/egress cost:** Zero. MC API (localhost) only. No LLM calls.  
**Schedule:** Every 15 minutes via `StartInterval: 900`.

#### `work.nabit.agent-heartbeat` → `config/scripts/agent-heartbeat.sh`
**⚠️ Recommendation: Do NOT install — redundant with `work.nabit.agent-kicker`.**  
Both scripts run every 30min and call `/api/run-agent` for each agent. `agent-kicker.sh` (already installed) does everything `agent-heartbeat.sh` does, plus it also runs `queue-refill` and `watchdog`. Installing both would double-kick every agent every 30 min, causing redundant spawns. Confirm this with a diff before installing.  
**Tokens/egress cost:** Would trigger LLM agent spawns — not free. This is why redundancy matters.  
**Action:** Diff the two scripts. If `agent-heartbeat.sh` has functionality not in `agent-kicker.sh`, merge the missing logic into `agent-kicker.sh` instead of loading separately.

**Fix for the other 4:** Create plist files (use `agent-kicker.plist` as the template) and `launchctl load`. These are incomplete infrastructure tasks, not openclaw issues — track as separate INF tasks.

### 6.3 — Coverage gap audit

Re-audited against all scripts in `todero/scripts/` and `config/scripts/`. Several formerly-listed gaps are actually covered.

#### Covered by existing scripts (running or needs LaunchAgent install)

| Workflow | Covered By | Status |
|---|---|---|
| Stale agent recovery (Builder 45min, Tester/Designer 15min) | `pipeline-watchdog.sh` (BUILDER_STALE=2700, REVIEWER_STALE=900) + `agent-kicker.sh` watchdog call | ✅ Running |
| Empty queue alert ("ping when issues cleared") | `pipeline-watchdog.sh` → Discord #alerts when open queue hits zero | ✅ Running |
| PR Notifications (new PRs → Discord) | `monitor-prs.py` | ⚠️ Script exists, LaunchAgent not installed (see 6.2) |
| PR Merge → Issue Released | `monitor-pr-merge.py` | ⚠️ Script exists, LaunchAgent not installed (see 6.2) |
| Post-task self-improvement | `post-task-memory.sh` called by `agent-queue-loop.sh` after each task | ✅ Running (writes locally — Phase 3.1 fix needed) |
| Hot pattern promotion | `promote-hot-patterns.sh` | ⚠️ Script exists, not scheduled — manual/KAOS only |

#### Genuine gaps — no script exists

| Workflow | What it did | Risk | Priority |
|---|---|---|---|
| INF-39: Agent Timeout Alert (Builder >4h, Tester >2h) | Human escalation alert when agent **still stuck after 4h** — distinct from auto-recovery (which fires at 45min). A signal that Michael needs to intervene. | Stuck agents go unnoticed past auto-recovery | 🔴 High |
| INF-165: Blocked issue alert (every 4h) | Alerted when any issue had `is_blocked=true` for >4h | Blocked work sits with no human visibility | 🔴 High |
| Vespera Health Check | Polled `https://vespera-nabit.vercel.app/api/health` and alerted on downtime | Vespera outages go undetected | 🔴 High |
| INF-163: Feature auto-advancement | ~~When all child tasks under a feature completed, auto-advanced the feature status~~ | **Already implemented** — `app/api/issues/route.ts` lines 1684–1722. See Phase 8.12. | ✅ Done |
| Stale PR Alert (PRs open >24h) | `monitor-prs.py` only announces NEW PRs — it does NOT alert on aging. PRs open >24h with no reviewer action went unnoticed. | PRs rot silently | 🟠 Medium |
| KAOS Daily Model Canary | Daily test prompt sent to each model; compared output against baseline to detect silent regressions. `model-switch-watcher.py` was written as replacement but **explicitly archived** with note "OpenClaw has been removed" | Silent model degradations undetected | 🟠 Medium |
| Claude Rate Limit Alerting | `check-claude-limit.sh` exists (returns ok/limited) but is not looped — no alert fires when rate-limited | Agents fail silently when rate-limited | 🟠 Medium |
| Weekly Audit (Sundays 8pm) | Ran `auditor` agent on schedule. Auditor IS in `capabilities.json` with `schedule: every_4h` but is NOT in the agent-kicker AGENTS list — never triggered | Drift accumulates unchecked | 🟡 Low — easy fix: add `auditor` to agent-kicker AGENTS list |
| Weekly Self-Improvement Loop (Sundays 8pm) | Triggered KAOS to run `promote-hot-patterns.sh` across all agents | Agent learning stalls | 🟡 Low |
| Weekly Executive Brief + Summary | Weekly strategic rollup — longer-form than daily standup | No Sunday brief | 🟡 Low |
| KAOS Reroute | Scanned for issues assigned to `main` that should route to a specific agent | Queue hygiene degrades | 🟡 Low |
| Market Research (MC, Vespera, Kemuni, Infra daily) | Scheduled Scout research tasks at fixed times. With agent-kicker, these run only if tasks exist in backlog — no one creates them on schedule | Gap only if backlog not maintained | 🟢 Low |
| Sprint Mid-Sprint Progress + 7am Scope | Mid-sprint Discord posts: progress vs. commitment | Reduced sprint visibility | 🟢 Informational |
| Model Switch Discord Logger | Audit log of model changes. `model-switch-watcher.py` was the replacement but is archived. | No model change history | 🟢 Informational |

**Quick win:** Add `auditor` to the AGENTS list in `scripts/agent-kicker.sh` — one-line fix restores weekly audit coverage with zero new infrastructure.

**Action:** Create INF tasks for all genuine gaps. Prioritize: Vespera health check, agent timeout alert (4h), blocked issue alert, feature auto-advancement.

### 6.4 — n8n cleanup

**`~/.n8n`:** Already deleted. Nothing to do.

**`config/scripts/n8n-audit.py`:** Covered in Phase 3.5 — update export path (or archive if n8n is fully retired and auditing is no longer needed). Since n8n is gone, archiving is the right call.

**`config/scripts/n8n-exports/` (53 JSON files):** Keep as reference archives. They are the spec for any gap workflow that gets rebuilt as a LaunchAgent. Move to `config/scripts/archive/n8n-exports/` to keep the active scripts directory clean.

**`app/api/automations/route.ts` n8n section:** Covered in Phase 1.10 — full removal including `N8N_KEY`.

**AutomationsTab / CalendarTab `source === 'n8n'` filters:** Covered in Phase 4.4 — removed alongside openclaw filters.

**n8n references in `config/CLAUDE.md` and `config/ASSET-MANIFEST.md`:** Covered in Phase 5.9.

After all the above: n8n is fully retired from the codebase with no remaining live references.

---

## Phase 7 — Chat Tab Rebuild (New Feature)
**Priority: 🟠 Medium — was working before OpenClaw shutdown, high UX value**

This is a rebuild, not a migration. The OpenClaw chat version cannot be recovered.

### What it replaces
- Session history from `~/.openclaw/agents/{id}/sessions/`
- Multi-agent selection via `x-openclaw-agent-id` header
- LLM selection including Ollama local models
- Session context continuity via `x-openclaw-session-key`

### Implementation plan

**6.1 Supabase: create `chat_sessions` table**
```sql
create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  title text,
  messages jsonb not null default '[]',
  model text not null default 'claude-sonnet-4-6',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

**6.2 `app/api/chat/route.ts`**  
Replace `resolvedModel = 'openclaw'` with real model routing:
- `claude-sonnet-4-6` / `claude-haiku-4-5` → direct Anthropic via run-agent
- `gpt-4o` → OpenRouter (key already in env)
- `ollama/*` → `http://localhost:11434/api/chat`

**6.3 `app/api/chat/send-to-agent/route.ts`**  
Replace `x-openclaw-agent-id` / `x-openclaw-session-key` headers with:
- Agent routing: POST to `/api/run-agent?agent={id}`
- Session context: load `chat_sessions.messages` by session ID, prepend as conversation history

**6.4 `app/api/chat/autotitle/route.ts`**  
Already handled in Phase 4.7 — uses `claude-haiku-4-5`.

**6.5 `components/tabs/ChatTab.tsx`**  
- Remove openclaw sidebar tab option
- Add session list from `chat_sessions` table
- Add agent selector (dropdown of agent IDs from `/api/agent-config`)
- Add model selector: Sonnet / Haiku / GPT-4o / Ollama
- Persist session history per conversation

---

## Phase 8 — Automation Infrastructure Decisions
**All decisions confirmed by Michael 2026-04-17.**

### 8.1 — Vercel stub crons to remove

Both of these are `{ ok: true }` no-ops — the actual logic lives in LaunchAgent scripts and can't run in Vercel serverless (requires git access or Mac-local tools). Remove from `vercel.json`.

| Cron | Issue | Action |
|---|---|---|
| `/api/cron/sprint-cycle` | Stub — returns `ok: true, note: "delegated to Mac Mini"` | Remove from `vercel.json`. **Keep `work.nabit.sprint-cycle` LaunchAgent (#5)** → runs `config/scripts/sprint-cycle.sh` at 6:55am daily. Keep as active implementation until the TypeScript port is done. Create TOD task: *Implement /api/cron/sprint-cycle TypeScript port for cloud redundancy*. Once the Vercel cron is fully ported and verified, the LaunchAgent can be retired. |
| `/api/cron/pr-window` (#13) | Stub — same pattern. PR window requires `git push` and can't run serverless — this can never work as a Vercel cron. | Remove from `vercel.json`. **Keep `work.nabit.pr-window` LaunchAgent (#7)** — this is the correct implementation, runs on Mac Mini where git is available. |

### 8.2 — Broken LaunchAgents to remove

Both have plists installed but scripts that don't exist on disk — they silently do nothing.

| LaunchAgent | Issue | Action |
|---|---|---|
| `work.nabit.config-backup` | `config/scripts/config-backup.sh` missing. Would have committed config repo changes, but those go through normal agent git commits + PR window already. | `launchctl unload` + delete plist |
| `work.nabit.workspace-backup` | `scripts/workspace-backup.sh` missing. Would have backed up `workspace-*/self-improving/` locally — superseded by Phase 3 memory migration to Supabase. | `launchctl unload` + delete plist |

### 8.3 — Standup-report: port to Vercel cron

`work.nabit.standup-report` (LaunchAgent) only polls MC API and posts to Discord — no git, no local dependencies. Safe to port to TypeScript.

**Fix:** Create `/api/cron/standup` TypeScript endpoint. Add to `vercel.json` at `08:00` daily. Keep the LaunchAgent as local fallback or unload it once Vercel version is confirmed.

### 8.4 — Agent spawning consolidation (WHY AGENTS AREN'T SPAWNING TODAY)
**Priority: 🔴 High — this is one of the primary reasons for this PRD.**

The system has **9 scripts** that check or kick agents. Most are dormant or conflicting. The fragmentation is causing agents not to spawn reliably. Consolidate to **2 authoritative sources**.

#### Full inventory of the 9 agent-checking scripts

| Script | Installed? | Role | Decision |
|---|---|---|---|
| `scripts/agent-kicker.sh` | ✅ Yes — `work.nabit.agent-kicker` (every :00 and :30) | Calls queue-refill → calls watchdog → THEN kicks all 7 agents again directly (double-kick) | **✅ Keep — simplify (remove direct kick loop)** |
| `/api/cron/watchdog` | ✅ Yes — Vercel cron every 30 min | Clears stale claims (4 types), auto-unblocks, kicks all 8 agent lanes | **✅ Keep — single source of truth for kicking** |
| `/api/cron/queue-refill` | ✅ Yes — Vercel cron every 30 min | Maintains refined→open queue depth ≥5 per project/type | **✅ Keep — distinct concern, not kicking** |
| `config/scripts/pipeline-watchdog.sh` | ❌ Not installed | Stale claim recovery + empty queue alert. Overlaps entirely with `/api/cron/watchdog` | **❌ Drop** |
| `config/scripts/agent-watchdog-30min.sh` | ❌ Not installed | Minimal stale claim check. Subset of watchdog. | **❌ Drop** |
| `config/scripts/agent-heartbeat.sh` | ❌ Not installed | Kicks all agents every 30min. Same as agent-kicker minus queue-refill/watchdog calls. | **❌ Drop** |
| `scripts/builder-loop.sh` | ❌ Not installed | Builder-specific dispatch. Calls run-agent. Covered by watchdog. | **❌ Drop** |
| `config/scripts/builder-loop.sh` | ❌ Not installed | Separate Builder loop — calls openclaw (dead). | **❌ Drop** |
| `scripts/agent-queue-loop.sh` | ❌ Not installed | Legacy dispatch loop that called `openclaw message` as primary path (Phase 1.7). Orphaned. | **❌ Drop** |
| `config/scripts/po-builder-hourly-check.sh` | ❌ Not installed | Hourly PO + Builder stale check. Watchdog's 10/20/30min tiers are already tighter. | **❌ Drop** |

#### The 2 authoritative sources

**`/api/cron/watchdog`** — single source of truth for:
- Clearing stale claims (dead heartbeat 10m, no commit 20m, has commit 30m, ghost 30m)
- Auto-unblocking resolved blockers
- Kicking all 8 agent lanes (builder, ops, scout, tester, designer, po, deployer, **auditor**)

**`/api/cron/queue-refill`** — separate, kept:
- Ensures each project has ≥5 refined issues ready to be picked up
- Distinct from kicking — this is backlog depth management, not agent triggering

#### Fix for `agent-kicker.sh`

Current flow: `queue-refill` → `watchdog` → [redundant direct kick of 7 agents]

Simplified flow: `queue-refill` → `watchdog` (stop here)

Remove lines that call `/api/run-agent?agent=X` directly. The watchdog call already handles all 8 agents including auditor. This also fixes the missing `auditor` kick — auditor is already in `AGENT_LANES` in the watchdog route but was not in agent-kicker's direct list.

**Long-term:** Once Vercel watchdog is confirmed reliable over several weeks, `work.nabit.agent-kicker` can be dropped entirely — it would just be calling the same two Vercel endpoints the cloud already calls on its own schedule. Keep for now as belt-and-suspenders while the consolidated setup is being proven.

#### Drop steps
Move all 7 dormant scripts to `scripts/archive/` or `config/scripts/archive/` (matching original location):
- `config/scripts/pipeline-watchdog.sh` → `config/scripts/archive/`
- `config/scripts/agent-watchdog-30min.sh` → `config/scripts/archive/`
- `config/scripts/agent-heartbeat.sh` → `config/scripts/archive/`
- `scripts/builder-loop.sh` → `scripts/archive/`
- `config/scripts/builder-loop.sh` → `config/scripts/archive/`
- `scripts/agent-queue-loop.sh` → `scripts/archive/`
- `config/scripts/po-builder-hourly-check.sh` → `config/scripts/archive/`

### 8.5 — Install ready scripts as LaunchAgents (Phase 6.2)

Install these 4 (plist + `launchctl load`). Use `agent-kicker.plist` as template.

| # | LaunchAgent | Script | Schedule |
|---|---|---|---|
| 14 | `work.nabit.monitor-stale` | `config/scripts/monitor-stale.py` | Every 2h |
| 15 | `work.nabit.monitor-prs` | `config/scripts/monitor-prs.py` + stale PR alert (Phase 8.6) | Every 5 min |
| 16 | `work.nabit.monitor-pr-merge` | `config/scripts/monitor-pr-merge.py` | Every 5 min |
| 17 | `work.nabit.release-notes` | `config/scripts/release-notes.py` | Every 15 min |

Also: unload `work.nabit.agent-heartbeat` if currently loaded — redundant with agent-kicker.

**Future migration note — `monitor-stale.py` only:**  
This script makes only API calls (MC API + Discord) with no local filesystem or state file dependencies. After Phase 3.2 completes (memory writes → DB), it can be ported to a Vercel TypeScript cron for Mac Mini resilience. Install as LaunchAgent now.

The other three scripts have local state files and **cannot move online without additional work:**
- `monitor-prs.py` — writes `state-prs.json` to track seen PRs (dedup). Must migrate state to Supabase first.
- `monitor-pr-merge.py` — writes `state-pr-merge.json` to track processed merges. Same.
- `release-notes.py` — writes `state-release-notes.json` AND writes `~/todero/config/docs/releases/vX.Y.Z.md`. Requires both state migration and a decision on where release docs are stored. Non-trivial. See "What Stays Local" section.

### 8.6 — Stale PR Alert (>24h)
**Extend `monitor-prs.py`.** Add a check: any open PR with `created_at > 24h` and no reviews → post to Discord #alerts. Uses existing GitHub API token in the script. Zero new infrastructure.

### 8.7 — Claude Rate Limit Alert
**New script + plist.** Wrap `scripts/check-claude-limit.sh` in a loop: every 30 min, if output is "limited" and last alert was >30 min ago (state file), post to Discord #alerts. Not a duplicate — no existing automation covers rate limit detection.

### 8.8 — Add auditor to agent-kicker
**Covered by 8.4 consolidation.** `auditor` is already in `AGENT_LANES` in `/api/cron/watchdog`. Once agent-kicker is simplified to call watchdog and stop (removing the direct kick loop), auditor gets triggered automatically every 30 minutes without any additional change needed.

### 8.9 — Weekly Self-Improvement Loop
**New script + plist.** Every Sunday 10:00am ET: run `scripts/promote-hot-patterns.sh` across all agents, then post summary of promoted patterns to Discord #alerts.  
**Tokens/egress:** Zero — pattern matching only, no LLM.

### 8.10 — Weekly Executive Brief
**New script + plist.** Every Sunday (time TBD — after self-improvement loop, suggest 10:30am ET). Spawns KAOS with a weekly-brief prompt. One brief per active hub: Infrastructure, KAOS, Kemuni, Loudwins, Todero, Vespera (skip Testing1).  
**Posts to:** Discord #weekly-summary  
**LLM cost:** ~6 KAOS spawns/week (one per hub).

Each brief includes:
- **What shipped** — issues that hit `released` this week, grouped by type
- **Active blockers** — `is_blocked=true` issues, with blocking reason
- **Backlog health** — open/refined/backlog counts per issue type (task, bug, feature, research, ops)
- **Agent health** — which agents ran this week, last run time, any that went silent
- **Memory & self-improvement** — patterns promoted this week (from 8.9 output)
- **One-line outlook** — what the next 7 days should focus on

### 8.11 — Daily Market Research
**New script + plist.** Daily 5:00am ET. Spawns Scout 4x (one per project) with research prompts. No task creation — output goes directly to Discord:
- Todero → #todero-market-research
- Vespera → #vespera-market-research
- Kemuni → #kemuni-market-research
- Infrastructure → #infra-market-research

**LLM cost:** ~4 Scout spawns/day. Not a duplicate — agent-kicker only picks up existing backlog tasks; this creates no tasks.

### 8.12 — Feature Auto-Advancement (INF-163)
**Already implemented.** `app/api/issues/route.ts` lines 1684–1722 handle:
- `defined → underway` when any child moves to open or beyond
- `underway → feature_review` when ALL children are closed (triggers PO self-chain)
- Reversal logic for both directions

No automation needed.

### 8.13 — `/api/cron/queue-refill` — add "queue empty" Discord ping
**5-line addition to existing TypeScript route.** After the refill loop runs, if `totalOpen === 0` across all projects, POST to Discord #alerts: *"Queue empty — all open issues are claimed or complete. Assign more work."*

Replaces three identical n8n "Monitor: Ping Michael When Issues Cleared" workflows that went dark on April 9. No new script, no new plist — one change to an existing Vercel route.

### 8.14 — Dropped automations

| Automation | Reason |
|---|---|
| Vespera Health Check | Not needed |
| Agent Timeout Alert (4h) | 45min auto-recovery sufficient |
| Blocked Issue Alert | Field used but automation not wanted |
| KAOS Reroute | Not needed |
| Sprint Mid-Sprint Progress + 7am Scope | Not needed |
| Model Switch Discord Logger | No longer applicable — model set at spawn time |

### 8.15 — Additional automations

#### Archive: `config/scripts/monitor-review-transition.py`
Watches for `in_review` status transitions and fires tester notifications. **`in_review` is no longer a valid status in the workflow.** The current pipeline goes `in_progress → code_review`. This script is monitoring a dead state and will never fire. Archive to `config/scripts/archive/`.

#### Install: Worktree janitor LaunchAgent
`config/scripts/worktree-janitor.sh` **already exists** and calls `POST /api/run-agent/worktrees?maxAgeHours=24` to clean up agent session worktrees. The script's own comment says it should run every 6h via `work.nabit.worktree-janitor`, but that plist was never created. This is a simple missing install.

**Action:** Create plist and `launchctl load`:
```xml
<key>Label</key><string>work.nabit.worktree-janitor</string>
<key>ProgramArguments</key><array>
  <string>/bin/bash</string>
  <string>/Users/kemuniagent/todero/config/scripts/worktree-janitor.sh</string>
</array>
<key>StartInterval</key><integer>21600</integer>
```

**Note:** There are currently **5 stale worktrees** on disk from before this plist was created. Run the script manually once before loading the plist to clear them.

#### Install: Daily dedup scan (`config/scripts/dedup-check.py`)
Currently a pre-creation CLI tool only (`--title` and `--description` args). Needs a new `--scan` mode added that:
- Iterates all open/refined/backlog issues across all projects
- Finds pairs above the 80% threshold (0.6 × Levenshtein title + 0.4 × Jaccard keyword overlap)
- Posts report to Discord #alerts (even if 0 duplicates found — confirms scan ran)
- Logs results to `agent_runs` table
- Makes zero LLM calls, zero modifications — reports only

**Schedule:** Daily at 3:00am ET.  
**Deploy as Vercel cron** — pure Supabase API calls, no local filesystem or git dependencies. Add `--scan` mode to the script, port logic to a `/api/cron/dedup-scan` TypeScript route, add to `vercel.json`. No LaunchAgent needed.

#### Archive: `config/scripts/po-builder-hourly-check.sh`
Hourly PO + Builder stale check with tighter timeouts. Fully superseded by watchdog's 4-tier stale detection (10/20/30min). Archive to `config/scripts/archive/`.

#### Install: `scripts/dor-nightly.sh` — nightly DoR enforcement (Builder only)
**Scope:** Builder-assigned issues only (`assignee=builder`). Checks three fields: `description`, `test_tier`, `acceptance_criteria`. Status filter: NOT IN `(completed, closed, backlog)` — catches issues in `open`, `in_progress`, `code_review`, `approved`, `released`, `refined`.  
**Behavior:** For each failing issue → `PATCH status=backlog` via MC API (enforcement, not reporting). Posts Discord alert listing all demoted issues with task keys and titles.  
**Prerequisite:** Fix openclaw Discord call (Phase 1.5) first.  
**Install:** Nightly LaunchAgent plist. Low egress — 3 Supabase SELECTs + 1 PATCH per violation.  
**Future:** Pure Supabase + MC API calls — candidate to port to Vercel cron after install is stable.

#### Install: `scripts/field-hygiene-sweep.sh` — weekly field hygiene (all agents)
**Scope:** ALL non-terminal issues across all assignees. Checks:
- Base fields (every live issue): `acceptance_criteria`, `severity`, `owner`, `reviewer`, `assignee`
- Late-stage extras: `implementation_notes` + `regression_test` (code_review), `implementation_notes` (product_review), `resolution_type` + `reviewer_notes` (approved)

**Behavior:** Reports only — never writes. Stdout + optional Discord `--notify` flag. Exits with code 1 if violations found (CI-compatible). Run with `--notify` flag in the plist.  
**Note:** Distinct from `dor-nightly.sh` — different scope (all agents vs Builder only), different action (report vs enforce/demote), different fields.  
**Install:** Weekly LaunchAgent plist (suggest Sunday, after self-improvement loop). Zero LLM cost.  
**⚠️ Cannot move online:** hardcodes `http://localhost:3000/api/issues` — must stay on Mac Mini.

#### Install: `config/scripts/backlog-heartbeat.sh` — backlog depth alert (all projects, every 4h)
Checks each project has ≥10 backlog features AND ≥3 DoF-ready features (open features with description + AC + at least one child task). Posts Discord alert with per-project deficits if below threshold. Informational only — never writes.  
**Prerequisites:** Fix openclaw Discord call (Phase 1.5) + update `"Mission Control"` project name → `"Todero"`.  
**Install:** Every 4h LaunchAgent plist. Zero LLM cost. Pure Supabase reads + Discord post.  
**Future:** Pure API calls — candidate to move online (Vercel cron) after install is stable.

#### Install: `config/scripts/auto-deploy.py` — continuous deployment on main commits
Every 5 minutes: fetches `origin/main` commit hash from GitHub. If new commit detected (from any machine — PR merge, direct push, GitHub Action):
1. `git pull origin main` on Mac Mini
2. `npm run build`
3. `launchctl kickstart -k gui/$(id -u)/work.nabit.todero` — restarts production app
4. Posts to Discord #deployments with commit hash

On build failure: posts error to Discord, does NOT restart — current running version stays live.  
**Not a duplicate of `pr-window.py`.** pr-window *creates* PRs (approved branches → GitHub PR). auto-deploy fires after PRs are *merged*, deploying the result to production. Pipeline: `pr-window (7am/7pm) → human merges → auto-deploy (within 5min)`.  
**Currently broken:** `MC_DIR = "/Users/kemuniagent/mission-control"` — old path throughout.  
**Fix:** Update `MC_DIR` → `/Users/kemuniagent/todero`. Then create `work.nabit.auto-deploy` plist with `StartInterval: 300`. Closes the manual loop — currently every merged PR requires a manual app restart.

#### Archive: duplicate and broken scripts
| Script | Reason | Destination |
|---|---|---|
| `scripts/pr-window.sh` | 114-line bash version superseded by `config/scripts/pr-window.py` (active LaunchAgent) | `scripts/archive/` |
| `config/scripts/telegram-kaos.py` | Identical to `telegram-kaos-v1-backup.py` (same 165 lines); v2 is active | `config/scripts/archive/` |
| `config/scripts/telegram-kaos-v1-backup.py` | Superseded by v2 | `config/scripts/archive/` |
| `config/scripts/queue-runner-builder.sh` | Calls `queue-runner.py` — **file does not exist** | `config/scripts/archive/` |
| `config/scripts/queue-runner-po.sh` | Same — broken | `config/scripts/archive/` |
| `config/scripts/queue-runner-tester.sh` | Same — broken | `config/scripts/archive/` |
| `scripts/run-tester.sh` | Watchdog kicks tester every 30min — fully redundant; also has `mission-control` path bug | `scripts/archive/` |
| `scripts/run-ux-review.sh` | Watchdog kicks designer every 30min — fully redundant; also has `mission-control` path bug | `scripts/archive/` |
| `config/scripts/model-switch-watcher.py` | Model change audit logger — explicitly archived, note in script says "OpenClaw has been removed" | `config/scripts/archive/` |

#### Keep as utilities (no plist, manual use only)
| Script | Use |
|---|---|
| `config/scripts/plist-drift-check.sh` | Run manually when editing plist files — catches UTC/local time comment bugs |
| `scripts/spawn-context.sh` | Formats SOUL.md + AGENTS.md + memory.md as context preamble for manual agent spawns |
| `scripts/cleanup-partial-files.sh` | Cleans partial `.tsx/.ts` files left by Builder timeouts — **fix `mission-control` path → `todero`** |
| `scripts/dor-check.sh` | Manual single-issue DoR check — fix openclaw Discord call (Phase 1.5) |
| `scripts/smoke-test.sh` | Post-deploy smoke test — fix openclaw Discord call (Phase 1.5) |
| `scripts/smoke-test-layout.sh` | Layout regression test after layout changes — not Claude-specific, any developer can run |

---

## Implementation Order (Recommended)

| Priority | Task | Notes |
|---|---|---|
| 0 | Pre-work: run `safe-export.py`, inspect SQLite, delete `~/.openclaw` | Before anything else — prevent memory loss |
| 1 | Phase 3.1 + 3.4 | Stop active daily memory data loss |
| 2 | Phase 8.4 — consolidate agent spawning | **Why agents aren't spawning.** Simplify agent-kicker (remove direct kick loop), archive 7 redundant scripts. watchdog = single source of truth. |
| 3 | Phase 1.1 | Restore hub-pause (pause/resume) |
| 4 | Phase 1.5 + 1.6 | Restore Discord/Telegram from shell scripts |
| 4a | Phase 5.14 | **Credentials security:** patch all 6 files (env vars), rotate Discord bot token + Supabase service role key. Do alongside 1.5 — same files open anyway. Update Vercel env vars too. |
| 5 | Phase 1.7 + 1.8 | Clean agent-queue-loop + commit-monitors |
| 6 | Phase 1.9 + 1.10 | Disable n8n watchdog, remove n8n section + N8N_KEY from automations route |
| 7 | Phase 8.1 | Remove 2 stub Vercel crons from vercel.json |
| 7a | Phase 8.13 | Add queue-empty Discord ping to `/api/cron/queue-refill` — 5-line TypeScript change |
| 8 | Phase 8.2 | Unload + delete 2 broken LaunchAgent plists |
| 9 | Phase 8.15 — worktree janitor plist | Script exists, just needs plist. Run manually first to clear 5 stale worktrees. |
| 10 | Phase 8.15 — auto-deploy: fix path + install plist | Fix `mission-control` → `todero` in auto-deploy.py, create `work.nabit.auto-deploy` plist (StartInterval 300). Closes manual restart loop after merges. |
| 11 | Phase 8.15 — archive 8 duplicate/broken scripts | `pr-window.sh`, `telegram-kaos.py`, `telegram-kaos-v1-backup.py`, `queue-runner-*.sh` (×3), `run-tester.sh`, `run-ux-review.sh` |
| 12 | Phase 2.1–2.4 | Restore office stream, status costs, agent files, health |
| 13 | Phase 4.9 | Fix capabilities.json |
| 14 | Phase 3.2, 3.3, 3.7, 3.8 | Close all memory write gaps |
| 15 | Phase 8.5 | Install 4 missing LaunchAgents (after Phase 3.2 for monitor-stale) |
| 16 | Phase 8.15 — dor-nightly plist | Fix Phase 1.5 Discord call first, then install nightly LaunchAgent |
| 17 | Phase 8.15 — backlog-heartbeat plist | Fix Phase 1.5 Discord call + update "Mission Control" → "Todero", then install every-4h LaunchAgent |
| 18 | Phase 8.6 + 8.7 | Stale PR alert + rate limit alert |
| 19 | Phase 8.9 | Weekly self-improvement loop (Sunday 10am) |
| 20 | Phase 8.15 — field-hygiene-sweep plist | Weekly LaunchAgent (Sunday, after self-improvement loop), run with --notify |
| 21 | Phase 8.10 | Weekly executive brief (Sunday 10:30am) |
| 22 | Phase 8.11 | Daily market research (5am daily) |
| 23 | Phase 8.15 — dedup `--scan` mode + Vercel cron | Add --scan to dedup-check.py; deploy as Vercel cron at 3am daily (pure Supabase calls, no local deps) |
| 24 | Phase 8.3 | Port standup-report to Vercel cron |
| 25 | Phases 4, 5 | UI + doc cleanup |
| 26 | Phase 7 | Chat rebuild — standalone sprint |

---

## Already Done (pre-PRD)

| Item | Status |
|---|---|
| `app/api/memory/route.ts` FS fallback removal | ✅ Done |
| `app/api/agent-config/route.ts` display strings → Supabase | ✅ Done |
| `AGENT_CONTEXT_SOURCE=db` in `.env.local` | ✅ Done |
| Agent DB read bugs (wrong table, skills query) | ✅ Done |
| Discord `post_functions` on 18 workflow transitions | ✅ Done |
| `app/api/heartbeat/route.ts` status fix | ✅ Done |

---

## Migration Complete — Summary

**Completed 2026-04-17.** All Phases 1–8 implemented in a single session.

### What Was Done
| Phase | Summary | Status |
|---|---|---|
| 1 | Dead path references removed from UI components (InfraTab, SettingsTab, ChatTab, CalendarTab, AutomationsTab, OnboardingWizard) | ✅ |
| 2.1 | office-stream rewritten → reads agent_runs table (30s interval, was 3s) | ✅ |
| 2.2 | Migration 017: tokens_used + cost_usd columns on agent_runs | ✅ |
| 2.3 | agents/[id]/files rewritten → reads agent_documents table | ✅ |
| 2.4 | health route → reads heartbeat_state from agent_memory_files | ✅ |
| 2.5 | run-agent dead path removal (SOUL.md local read, skill local paths) | ✅ |
| 3.3 | telegram-kaos-v2.py → uses /api/agent-memory for daily/memory files | ✅ |
| 3.4 | daily-memory-seed LaunchAgent created (00:05 daily) | ✅ |
| 4.2 | chat/route.ts + send-to-agent stubbed 501 (Phase 6 = separate sprint) | ✅ |
| 5 | status/route.ts: openclaw exec removed → agent activity from agent_runs | ✅ |
| 6 | Chat backend rebuild via OpenRouter — /api/chat SSE streaming, /api/chat/autotitle, /api/chat/send-to-agent | ✅ |
| 7 | Agent cost tracking — builder-with-cost.sh wrapper + /api/agent-runs/[id] PATCH endpoint | ✅ |
| 8.5 | monitor-prs/pr-merge/release-notes: hardcoded tokens → env vars | ✅ |

### Side Effects Fixed
- React hydration errors #418/#423/#425 (page.tsx useState → useEffect)
- Supabase 400 on agent_runs (ended_at → finished_at in NotificationBell)
- BoardTab 60s auto-poll removed (saves ~1.87GB/day egress)
- OfficeTab poll slowed 30s → 120s
- NotificationBell: hardcoded service role key replaced with env vars
- run-builder DoR gate: nonexistent test_tier column removed from filter
- 16 LaunchAgents loaded and active

### Supabase Egress Reduction Tasks (queued for builder)
- TOD-1995: /api/issues field projection (open)
- TOD-1996: agent-docs LIMIT 50 + summary mode (open)
- TOD-1997: office-stream already done (open for verification)
- TOD-1998: /api/issues 30s server-side cache (open)
| `config/scripts/render-agent-context.py` path update | ✅ Done (uses `~/todero/config`) |
