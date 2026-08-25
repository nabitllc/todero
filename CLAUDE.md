> Cloud/sandbox sessions (claude.ai/code): clone `github.com/michsaenz/Mich-Brain2` and follow its `BOOTSTRAP.md` before working. Local sessions ignore this - the global shim already covers it.

# CLAUDE.md — Todero (Mission Control)

This is the Todero Next.js app — the operational hub for the Todero platform.
It runs the MC API, issue board, and agent visualization dashboard.

## What This App Is

Todero is a Next.js 14 app (App Router) that provides:
- **MC API** (`/api/issues`) — the single source of truth for all issue operations
- **Issue board** — sprint management, backlog, epics, features, tasks
- **Agent dashboard** — real-time visualization of agent activity (pixel-art office)
- **Supabase integration** — all data persisted in Supabase

**Production URL:** `https://kaos.nabit.work` (Cloudflare tunnel → localhost:3000)
**Local dev port:** `3000`

## Companion Repo

Agent config, memory, scripts, and skills live in `todero/config`:
- Path: `/Users/kemuniagent/todero/config`
- GitHub: `github.com/nabitllc/todero/config`
- Read `todero/config/CLAUDE.md` for full agent/operational context

**Note (TOD-798):** `~/.openclaw/workspace` is the *old* path and no longer exists.
Do not reference it. The migration happened 2026-04-09. If you see any file
pointing at `.openclaw/workspace`, it's a stale bug — fix it to `todero/config`.

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

## Layout Integrity (MC-175, updated TOD-2381 / scope-is-a-boundary) — CRITICAL

The responsive layout has broken multiple times. These patterns must never be removed:

| Element | Required class |
|---|---|
| Desktop sidebar (`components/nav/PrimaryNav.tsx`) | `hidden lg:flex` |
| Mobile bottom nav (`components/nav/MobileNav.tsx`) | `lg:hidden fixed bottom-0` |

There is no hamburger button and no mobile "more" menu. Both existed in the
old 20-item flat tab bar and were deliberately removed at TOD-2381
(nav-six-destinations): the six destinations — and now, within Work, four
views instead of eight (design/Work.dc.html; see components/nav/config.ts) —
all fit in the bottom nav's `grid-cols-6` without an overflow menu.
`PrimaryNav`/`MobileNav` do not render one, and restoring one is a regression,
not a fix.

The sidebar pairs with the phone nav at the `lg:` breakpoint, not `md:`, and
this is intentional, not a typo of the historical `hidden md:flex`: an `md:`
sidebar shown alongside an `lg:hidden` phone nav would put BOTH on screen at
once between 768px and 1023px wide (`md` starts at 768, `lg` at 1024). The
two breakpoints must always match each other, whichever one they are.

After any layout-touching commit, run smoke test before marking `in_review`.
`bash scripts/smoke-test-layout.sh` also runs `scripts/no-silent-empty.mjs`
(no tab may render an empty state over an unchecked API error) and
`scripts/no-unscoped-issues.mjs` (no `dbUrl('issues?...')` call may skip the
project + archived-rows clauses — see that script's header for what it does
and does not cover).

## Code Quality Rules

- 200-line component limit — extract tabs to `components/tabs/`
- No inline styles — use Tailwind tokens
- TypeScript strict mode — no `any` without justification
- `trash` > `rm` for file deletions

## Environment

```
# .env.local (not committed)
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
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

LaunchAgent label: `work.nabit.todero` (auto-starts at boot, serves `kaos.nabit.work`)

## Git Branches

### Branch naming convention
- `feat/tod-XXXX` — one branch per issue (builder/ops only create these)
- `release/next` — staging branch, merges into main at PR windows
- `main` — production

### Rules
- Only `builder` and `ops` agents create feature branches (CODE_AGENTS set in `lib/claude-code.ts`)
- Never create branches manually during development; let run-agent handle it
- After merging, deployer runs `git fetch --prune` to clean up remote-tracking refs
- Stale local branches should be pruned after confirming changes are in main:
  - `backup/*`, `sync/*`, `release/<date>-*` → delete once content lands in main
  - `feat/po-notask-*` → zombie branches from old bug; always safe to delete
  - `deploy-*` → temporary deployer branches; delete after PR window closes
