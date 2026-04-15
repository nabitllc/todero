# MEMORY.md — KAOS Long-Term Memory
# Updated: 2026-04-08 — Post OpenClaw migration

## Identity
- I am KAOS 🧠 — Nabit AI Orchestration System
- Orchestrator for Michael Saenz (goes by "Mich"), sole owner of Nabit LLC
- Running on Claude Code — no OpenClaw, no n8n

## Michael
- Timezone: Eastern (EDT)
- Communication: Telegram (primary — @GlitchSpeck), Discord
- Discord user ID: 409194957098713088 | username: iammichikyu
- Style: direct, no filler, hates fluff
- Personal email: msaenzcor@gmail.com | Business: michael@nabit.app

## Current Focus — Todero only
Vespera and Kemuni are PAUSED. All work is on Todero platform.

## Projects
- **Todero** — AI agent orchestration platform (this system). Active.
- **Vespera** — goth social app. PAUSED.
- **Kemuni** — community SaaS. PAUSED.

## Todero Infrastructure
- **Mission Control app:** ~/mission-control | Next.js 14 + Supabase + Tailwind
- **Live at:** https://kaos.nabit.work (Cloudflare tunnel, permanent)
- **MC API:** http://localhost:3000/api/issues (all issue ops go through here)
- **Supabase (Todero):** https://twthgapiouiqhavrcnry.supabase.co
- **GitHub:** github.com/nabitllc/kaos-mission-control (mission control app)
- **GitHub:** github.com/nabitllc/kaos-config (agent config, scripts, memory)
- **Auto-deploy:** pushes to main → Mac Mini pulls + rebuilds every 5 min

## Agent System
- **Runner:** Claude Code (`/Users/kemuniagent/.local/bin/claude`)
- **Workspace:** ~/.openclaw/workspace (kaos-config repo)
- **No OpenClaw. No n8n. No model switching.**
- All agents use Claude (Sonnet for heavy work, Haiku for monitoring)

## Agent Roster
| Agent | Role | Model |
|---|---|---|
| KAOS (main) | Orchestrator | claude-sonnet-4-6 |
| Builder | Code implementation | claude-sonnet-4-6 |
| Tester | QA review | claude-haiku-4-5 |
| Designer | UI/UX review | claude-haiku-4-5 |
| Scout | Research | claude-sonnet-4-6 |
| Ingo | Infrastructure | claude-haiku-4-5 |
| PO | Issue structuring | claude-sonnet-4-6 |

## Always-On Services (LaunchAgents)
- Mission Control Next.js (port 3000)
- Builder loop — Claude Code, every 10 min
- PR window — git push + GitHub PR at 7am/7pm ET
- Auto-deploy — pulls GitHub → rebuilds MC every 5 min
- monitor-completed — task done → Discord (2 min)
- monitor-prs — new PRs → Discord (5 min)
- monitor-pr-merge — merged PR → issue released (5 min)
- monitor-stale — stale issues → Telegram (2h)
- monitor-review-transition — in_review → code_review (2 min)
- monitor-claude-limit — rate limit → Telegram (15 min)
- standup-report — daily standup → Discord (8am)
- telegram-kaos — KaosClaudeBot (Claude) + KaosGPTBot (GPT-4o) always on

## Telegram Bots
- **KaosClaudeBot** — Claude-powered KAOS, token: 8792497927:AAEcRevJI2KnxlKpHochhSJj4-SviK281is
- **KaosGPTBot** — GPT-4o-powered KAOS, token: 8751778428:AAHkfR3s0bVsFUyS3dH8LyZPgfmAXji90DU
- Authorized users: @iammichikyu, @msaenzcor, @GlitchSpeck
- GPT via OpenRouter key: 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

## Issue Lifecycle — MANDATORY
- All issue ops via MC API only (never direct Supabase for status)
- POST/PATCH http://localhost:3000/api/issues
- Status flow: backlog → defined → open → in_progress → in_review → code_review → approved → done
- Required on PATCH to in_review: implementation_notes, commit_sha, regression_test
- Builder commits locally only — NEVER git push (KAOS pushes at 7am/7pm windows)
- Commit format: feat(TASK-KEY): description [skip ci]

## Preferences
- No filler, no "Great question!", no narration on tool calls
- Short responses — 1-2 paragraphs unless detail requested
- Always provide ≥1 concrete alternative + clear recommendation
- trash > rm for deletions
- No data on Chinese servers

## Key Credentials
- Supabase service role (Todero): eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q
- GitHub token: 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
- Discord bot token: MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo
- Cloudflare tunnel ID: e776dde7-37ae-42c0-b843-1d735bae152b
- Domain: nabit.work (Namecheap, DNS on Cloudflare)
