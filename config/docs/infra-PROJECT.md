# PROJECT.md — Infrastructure Dossier

## What It Is

The Infrastructure project covers everything that keeps Todero (and its satellites Kemuni, Vespera) running reliably on Michael's laptop without human babysitting. Not product code — the stuff that lives at the boundary between dev tools, macOS, Supabase, Discord, Telegram, and the pipeline agents themselves.

Treated as a first-class project with its own epics, backlog, and SME. Everything that goes wrong overnight lives here.

## Scope

### In scope
- **LaunchAgents** (`~/Library/LaunchAgents/work.nabit.*.plist`)
  - `work.nabit.todero` (Next.js server)
  - `work.nabit.cloudflared` (tunnel to kaos.nabit.work)
  - `work.nabit.telegram-kaos` (Telegram bot polling)
  - `work.nabit.agent-heartbeat`, `work.nabit.monitor-stale`, `work.nabit.monitor-stale-smoke`
  - `work.nabit.sprint-cycle`, `work.nabit.pr-window`, `work.nabit.standup-report`
  - `work.nabit.monitor-prs`, `work.nabit.monitor-pr-merge`, `work.nabit.plist-drift-check`
- **Start scripts** (`~/todero/start.sh`) — self-healing boot sequence
- **node_modules integrity** (`ensure-deps`, `predev/prebuild/prestart` hooks)
- **Runtime adapters** (`lib/runtimes/{claude-code,codex,cursor,openai-api}.ts`)
- **Worktree isolation** (`lib/runtimes/worktree.ts`, `~/agent-worktrees/`)
- **Observability**
  - Supabase tables: `agent_runs`, `issues.rejection_count`, token ledger (when applied), `workflow_transitions`, `inbox`
  - Logs: `/tmp/agent-*.log`, `/tmp/todero.log`, `~/todero/config/logs/*.log`
- **Discord + Telegram transports** (`/api/notify`, `postDiscord` helpers, `telegram-kaos.py`)
- **TCC grants** (App Management + Full Disk Access for `node` + `claude`)
- **Git workflow integrity** (pre-push hook PR window, post-commit auto-rebuild, config/ auto-push)

### Out of scope
- Product features (that's Todero/Kemuni/Vespera SMEs)
- Database schema design for product (that's the product SME)
- Agent prompt content (that's the agent queue config)

## Current State (as of 2026-04-11)

### Recent wins
- Rejection-aware spawn prompt (stops Builder regen loops)
- Worktree isolation shipped (`git worktree add` per spawn)
- 10-minute Telegram timeout + photo download + typing heartbeat
- monitor-stale watchdog gets `transitioned_by` right now
- LaunchAgent plist times corrected to local time (were running 4h off as UTC)

### Known issues
- **Dual next-server processes** — concurrent builds (Ops running `next build` in its worktree while prod LaunchAgent also builds) can race and produce zombie servers on :3000. Fix: build lockfile in start.sh OR block agents from running `next build` (they should only TypeScript-check via `tsc --noEmit`).
- **Worktree GC not automatic** — `gcStaleWorktrees()` exists in `lib/runtimes/worktree.ts` but isn't wired to a cron or spawn-time call. Stale worktrees accumulate until manual cleanup.
- **Token ledger migration unapplied** — `migrations/008_token_ledger.sql` exists but was never run through Supabase Dashboard. Middleware silently no-ops.
- **TCC grants not scripted** — every new Mac requires manual "App Management" + "Full Disk Access" for node + claude binaries. setup-laptop.sh (TOD-808) would automate this.
- **Hardcoded service-role JWTs** — most purged (TOD-631/767/819 commits) but audit needed to confirm no survivors.
- **Stale `feat/tod-*` branches** accumulate when Builder exits without merge. Git GC doesn't touch them.

## Key Architectural Decisions

| Decision | Why |
|---|---|
| LaunchAgents > cron | macOS-native, survives reboot, per-user, no root needed |
| Local-time StartCalendarInterval | launchd doesn't support a TimeZone key; writing UTC causes 4-hour drift |
| Worktree-per-spawn | Parallel agents on different branches without working-tree collision |
| Node-detached spawning with `nohup` + disown | Prevents parent (Next.js server) from killing children on restart |
| `[spawn-start]`/`[spawn-exit]` sentinel lines | Gives us visibility into silent agent deaths without keeping Node handles |
| Fire-and-forget Discord notifications | Pipeline never blocks on Discord latency |
| predev/prebuild/prestart ensure-deps | Heals `node_modules` before every lifecycle command — typescript deletion bit us once |

## Where to Look First (Infra SME reading order)

1. `~/todero/config/SOUL.md`, `AGENTS.md`, `CLAUDE.md` — same foundation as every other SME
2. `~/todero/config/memory/2026-04-10.md` + `2026-04-11.md` — most recent incidents
3. `~/Library/LaunchAgents/work.nabit.*.plist` — all plists
4. `~/todero/start.sh` — boot sequence
5. `~/todero/lib/runtimes/` — adapter layer
6. `~/todero/app/api/run-agent/route.ts` — how spawns work today
7. `~/todero/config/scripts/monitor-*.py`, `sprint-cycle.py`, `pr-window.py` — cron scripts
8. `~/todero/config/scripts/telegram-kaos.py` — Telegram bot
9. `/tmp/todero.log`, `/tmp/todero-error.log` — live production logs

## Typical Infrastructure Epic Patterns

Good Infra epics look like:
- "Harden X so it can't fail silently" → monitor + smoke test + alert
- "Observability for Y" → schema + ingestion + UI
- "Self-heal Z" → detect + recover + log
- "One-command install" → script + verification
- "Runtime adapter for N" → implement AgentRuntime interface + registry entry + smoke test

Bad Infra epics look like:
- "Fix production bugs" → too vague; should be a specific audit with AC
- "Make agents smarter" → not infra, that's agent queue config
- "Improve UI" → not infra, that's Todero SME
