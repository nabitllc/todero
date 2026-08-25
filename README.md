# Todero

AI-run company OS. Next.js 14 + Supabase + TypeScript.

**Live:** [https://kaos.nabit.work](https://kaos.nabit.work) (Cloudflare tunnel → `localhost:3000`)

## Quickstart

```bash
git clone git@github.com:nabitllc/todero.git
cd todero
npm install
npm run build
npm start                  # serves on :3000
```

Open [http://localhost:3000](http://localhost:3000). Production is auto-started
by the `work.nabit.todero` LaunchAgent on macOS.

## Architecture

| Layer | What |
|---|---|
| `app/` | Next.js App Router pages and API routes |
| `app/api/issues/` | MC API — single source of truth for issue ops |
| `app/api/run-agent/` | Pluggable agent dispatch (see "Runtime adapter" below) |
| `components/tabs/` | Tab components (Board, Features, Issues, Chat, etc.) |
| `lib/runtimes/` | Runtime adapter registry (claude-code, codex, cursor) |
| `lib/agent-queue.ts` | Per-agent WIP limits + pickup criteria |
| `migrations/` | Supabase SQL migrations (apply via Dashboard SQL Editor) |
| `middleware.ts` | Auth cookie gate (admin + viewer roles) |

## Runtime adapter — portability

Todero's agent pipeline is driven by `/api/run-agent`, which dispatches through
`lib/runtimes/` — a pluggable registry. Switch the underlying LLM CLI with an
env var:

```bash
TODERO_RUNTIME=claude-code npm start   # default — Claude Code CLI (Anthropic)
TODERO_RUNTIME=codex       npm start   # OpenAI Codex CLI
TODERO_RUNTIME=cursor      npm start   # Cursor CLI
```

Per-request override: `POST /api/run-agent?agent=builder&runtime=codex`.
List available runtimes: `GET /api/run-agent/runtimes`.

Adding a new runtime is a single file — see `lib/runtimes/claude-code.ts` as
the reference implementation and `lib/runtimes/types.ts` for the contract.

## Git worktree isolation (TOD-806)

Every agent spawn runs in its own isolated git worktree at
`~/agent-worktrees/<agent>-<taskKey>-<timestamp>`. The interactive editor
session in `~/todero` is never switched to a feature branch as a side-effect
of a spawn, and parallel agents working on different issues cannot collide.

- **Created** via `git worktree add -b feat/tod-X`
- **`node_modules` symlinked** from the main repo (no reinstall per spawn)
- **`.next` NOT symlinked** — each worktree builds its own to avoid webpack chunk collisions
- **Teardown** scheduled 60 minutes after spawn
- **Janitor** (`work.nabit.worktree-janitor` LaunchAgent) runs every 6 hours and
  removes anything older than 24 hours
- **Visibility:** `GET /api/run-agent/worktrees` lists active worktrees

The worktree directory is **outside** `~/todero`, so it's already invisible to
`.gitignore`. No configuration needed.

## Non-negotiable agent rules (enforced in the spawn prompt)

Pipeline agents must:

1. Work inside their assigned worktree, not the shared `~/todero`
2. Commit locally only — **never `git push`**
3. Never run `gh pr create`, `gh pr merge`, `gh pr close`, or `gh pr review`
4. PATCH the issue to its completion status via
   `http://localhost:3000/api/issues` before ending the session
5. Commit format: `feat(TASK-KEY): description [skip ci]`
6. Run `npm run build` before committing (zero TypeScript errors)

KAOS batches all PRs at **7am** and **7pm ET** via `scripts/pr-window.py`
(actually `~/kaos-config/scripts/pr-window.py`, which is what the LaunchAgent
runs). Per-issue PRs are never created.

## Related repos

- **`~/kaos-config`** — Agent definitions, memory, skills library, operational
  scripts, self-improving state. Agents load their SOUL/AGENTS/memory from here
  at spawn time. See `~/kaos-config/CLAUDE.md`.

## Environment

```bash
# .env.local (not committed)
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
MC_PASSWORD=kaos2026
MC_VIEWER_PASSWORD=view2026
TODERO_RUNTIME=claude-code  # or codex, cursor
CLAUDE_BIN=/Users/kemuniagent/.local/bin/claude
CODEX_BIN=/opt/homebrew/bin/codex
CURSOR_BIN=/opt/homebrew/bin/cursor-agent
```

## Database migrations

`migrations/` holds SQL files. Supabase's REST API does not expose ad-hoc SQL,
so each migration must be applied manually:

1. Open [Supabase Dashboard → SQL Editor](https://supabase.com/dashboard/project/<your-project-ref>/sql)
2. Paste the contents of the migration file
3. Click **Run**

The file name encodes order (`001_...sql`, `002_...sql`, etc.). Apply in order.
