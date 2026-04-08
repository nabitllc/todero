# CLAUDE.md — Mission Control (kaos-mission-control)

This is the Mission Control Next.js app — the operational hub for the Todero platform.
It runs the MC API, issue board, and agent visualization dashboard.

## What This App Is

Mission Control is a Next.js 14 app (App Router) that provides:
- **MC API** (`/api/issues`) — the single source of truth for all issue operations
- **Issue board** — sprint management, backlog, epics, features, tasks
- **Agent dashboard** — real-time visualization of agent activity (pixel-art office)
- **Supabase integration** — all data persisted in Supabase

**Always running at:** `http://localhost:3000`

## Companion Repo

Agent config, memory, scripts, and skills live in `kaos-config`:
- Path: `/Users/kemuniagent/.openclaw/workspace`
- GitHub: `github.com/nabitllc/kaos-config`
- Read `kaos-config/CLAUDE.md` for full agent/operational context

## Session Startup

Before any coding work:
1. Read this file
2. Read `AGENTS.md` — issue lifecycle, agent roles, sprint workflow
3. Read `SOUL.md` — Builder behavior rules
4. Run `npm run build` to verify baseline before touching anything

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Database:** Supabase (Postgres)
- **Auth:** None (internal tool)
- **Deploy:** Vercel (production), local `next start` (dev)
- **Language:** TypeScript (strict)

## Key Directories

| Path | What |
|---|---|
| `app/` | Next.js App Router pages and API routes |
| `app/api/issues/` | MC API — the core issue management endpoint |
| `components/` | Shared UI components |
| `components/tabs/` | Tab components (issues, epics, sprints, agents, etc.) |
| `data/` | Static data files, Tiled map files, tilesets |
| `lib/` | Supabase client, utilities |
| `hooks/` | Custom React hooks |
| `migrations/` | Supabase SQL migrations |
| `scripts/` | Build and smoke-test scripts |
| `docs/` | Architecture docs, memory |
| `supabase/` | Supabase config |

## MC API — MANDATORY RULES

**All issue operations go through MC API. Never direct Supabase for status changes.**

```
POST  /api/issues   — create issue (enforces required fields)
PATCH /api/issues   — update issue (fires Discord notifications)
GET   /api/issues   — list all issues
```

Required fields for creation: `title`, `project`, `type`, `priority`, `assignee`, `acceptance_criteria`

Required PATCH fields when moving to `in_review`:
- `implementation_notes`
- `commit_sha`
- `regression_test` (API rejects without this)

## Builder Rules

- **Never `git push`** — KAOS pushes at 7am/7pm sprint windows only
- Commit format: `feat(TASK-KEY): description [skip ci]`
- WIP commits: `[WIP] partial: description`
- Run `npm run build` before every commit — zero TypeScript errors required
- Run `bash scripts/smoke-test-layout.sh` after any change to `app/page.tsx`, sidebar, or mobile nav

## Layout Integrity (MC-175) — CRITICAL

The responsive layout has broken multiple times. These patterns must never be removed:

| Element | Required class |
|---|---|
| Desktop sidebar | `hidden md:flex` |
| Mobile bottom nav | `lg:hidden fixed bottom-0` |
| Hamburger button | `md:hidden` |
| Mobile more menu | `lg:hidden fixed bottom-[56px]` |

After any layout-touching commit, run smoke test before marking `in_review`.

## Code Quality Rules

- 200-line component limit — extract tabs to `components/tabs/`
- No inline styles — use Tailwind tokens
- TypeScript strict mode — no `any` without justification
- `trash` > `rm` for file deletions

## Environment

```
# .env.local (not committed)
NEXT_PUBLIC_SUPABASE_URL=https://twthgapiouiqhavrcnry.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Starting the App

```bash
# Development
npm run dev

# Production (what launchd runs)
npm run build && npm start
```

LaunchAgent label: `com.nabit.mission-control` (auto-starts at boot)

## Git Branches

Current active branches (as of migration):
- `main` — production
- `feat/mc-features-tab`
- `feat/mc-sprint1-polish`
- `feat/mc-sprint2`
- `feat/tod-activate-inprogress`
- `feat/tod-571-kaos-backlog-reset`
- `feat/tod-api-lane-enforcement`
