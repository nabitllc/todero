# CLAUDE.md — KAOS Config

This is the agent config directory (merged from kaos-config 2026-04-13) for the Todero platform.
Read this file at the start of every session.

✅ Repo is at `~/todero/config`. If you see `~/.openclaw/workspace` anywhere, that is a stale reference — update it.

## Who You Are

Read `SOUL.md` for your personality, values, and response rules.
Read `AGENTS.md` for your operational protocols, issue lifecycle, and delegation rules.

## What This Repo Is

This directory (`~/todero/config`, formerly the kaos-config repo) contains:
- Agent definitions, roles, and protocols (`AGENTS.md`, `SOUL.md`)
- Accumulated project memory (`MEMORY.md`, `memory/`)
- Self-improving patterns and corrections (`self-improving/`)
- Proactivity and heartbeat system (`proactivity/`)
- Operational scripts (`scripts/`)
- Skills library (`skills/`)
- Templates (`templates/`)

The parent repo is `todero` — the Next.js app that runs the Todero API,
UI, and issue board at `http://localhost:3000`.

## Session Startup (every session)

1. Read `SOUL.md`
2. Read this file (`CLAUDE.md`)
3. Read `AGENTS.md`
4. Read `self-improving/memory.md` (HOT tier)
5. Read `memory/YYYY-MM-DD.md` (today + yesterday)
6. Read `self-improving/session-state.md` for current objective
7. If working on a specific project, load the matching domain/project file

## Key Paths

| What | Path |
|---|---|
| Todero app | `/Users/kemuniagent/todero` |
| Todero API | `http://localhost:3000/api/issues` |
| Supabase | `${NEXT_PUBLIC_SUPABASE_URL}` |
| Agent scripts | `./scripts/` |
| Skills | `./skills/` |
| Daily memory | `./memory/YYYY-MM-DD.md` |
| Long-term memory | `./MEMORY.md` |
| Self-improving | `./self-improving/` |
| Proactivity | `./proactivity/` |

## Scripts Reference

| Script | What it does |
|---|---|
| `scripts/builder-loop.sh` | Spawns Claude Code as Builder every 10min when open issues exist |
| `scripts/queue-watchdog.sh` | Restarts dead runners, alerts on missing heartbeats |
| `scripts/start-queue-runner.sh` | Launches a queue runner for a given agent |
| `scripts/standup-report.py` | Generates daily standup summary |
| `scripts/check-claude-limit.sh` | Checks if Claude API is rate-limited |

## Production URL

**Production = `https://kaos.nabit.work`** (Cloudflare tunnel → `localhost:3000` → the `work.nabit.todero` LaunchAgent)

When docs/comments refer to "production", use the URL, not the launchd label. The label is an implementation detail.

## LaunchAgents (always-on services)

| Label | What it runs |
|---|---|
| `work.nabit.todero` | Todero Next.js app (serves `kaos.nabit.work`) |
| `work.nabit.cloudflared` | Cloudflare tunnel → localhost:3000 |
| `work.nabit.telegram-kaos` | Telegram bot listener (polls KaosClaudeBot + KaosGPTBot) |
| `work.nabit.agent-kicker` | Every 30min — calls watchdog + queue-refill Vercel crons |
| `work.nabit.monitor-stale` | Every 2h — auto-recovers stuck in_progress issues |
| `work.nabit.monitor-prs` | Every 5min — new PR → Discord #pr-reviews |
| `work.nabit.monitor-pr-merge` | Every 5min — merged PR → transition issue to released |
| `work.nabit.sprint-cycle` | Daily 6:55am ET — close/start sprint |
| `work.nabit.pr-window` | 7am + 7pm ET — batch release PR |
| `work.nabit.standup-report` | Daily 8am ET — standup Discord post |
| `work.nabit.dor-nightly` | Daily 2am — DoR sweep, open → backlog on missing fields |
| `work.nabit.backlog-heartbeat` | Every 4h — backlog health check + Discord ping |
| `work.nabit.daily-memory-seed` | Daily 00:05 — upsert today's agent_memory_files daily row |
| `work.nabit.worktree-janitor` | Every 6h — prune stale git worktrees |
| `work.nabit.branch-janitor` | Every 6h — prune stale release/* on origin + abandoned feat/tod-NNNN locally |
| `work.nabit.drift-audit-nightly` | Daily 2:30am — merged-branches-audit + direct-to-main-audit (flag code/issue drift) |

## Issue Lifecycle — MANDATORY

**Always use Todero API. Never direct Supabase for status changes.**

```
POST  http://localhost:3000/api/issues     — create issue
PATCH http://localhost:3000/api/issues     — update status / fields
GET   http://localhost:3000/api/issues     — list all issues
```

Status flow: `backlog → defined → open → in_progress → in_review → approved → done`

Required PATCH fields when moving to `in_review`:
- `implementation_notes` — what was built
- `commit_sha` — from `git rev-parse HEAD`
- `regression_test` — command or steps to verify (REQUIRED — API rejects without it)

## Agent Roster

| Agent | Role | Model |
|---|---|---|
| main (KAOS) | Orchestrator / Chief of Staff | claude-sonnet-4-6 |
| builder | Coding implementation | claude-sonnet-4-6 |
| tester | QA review | claude-haiku-4-5 |
| designer | UX/design review | claude-haiku-4-5 |
| scout | Research | claude-sonnet-4-6 |
| ops | Infrastructure | claude-haiku-4-5 |
| po | Product Owner / issue structuring | claude-sonnet-4-6 |
| kemuni-sme | Kemuni product specialist | claude-sonnet-4-6 |
| vespera-sme | Vespera product specialist | claude-sonnet-4-6 |

## Git Rules

- **Never `git push`** from Builder sessions — KAOS pushes at 7am/7pm sprint windows only
- Commit format: `feat(TASK-KEY): description [skip ci]`
- WIP commits: `[WIP] partial: description`
- `trash` > `rm` for destructive operations

## Memory Rules

- Factual history → `memory/YYYY-MM-DD.md` and `MEMORY.md`
- Reusable execution lessons → `self-improving/`
- No mental notes — if it matters, write it to a file
- Update `self-improving/session-state.md` at end of every substantive session
