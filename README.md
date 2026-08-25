# Todero

AI-run company OS. Next.js 14 + TypeScript, on the database of your choice —
a file on disk by default, hosted Postgres when you point it at one.

**Live:** [https://kaos.nabit.work](https://kaos.nabit.work) (Cloudflare tunnel → `localhost:3000`)

## Quickstart

Prerequisite: **Node 22.5+**. Nothing else — no Docker, no Homebrew, no
database server, no account with anybody. macOS, Linux and Windows all take the
same four lines, and the result is a working board with real data in it.

```bash
git clone git@github.com:nabitllc/todero.git
cd todero
npm install
npm run setup              # writes .env.local, probes your LLM, creates the database
npm run dev                # serves on :3000
```

Open [http://localhost:3000](http://localhost:3000).

`npm run setup` is a plain Node script. It copies `.env.local.template` to
`.env.local` (never overwriting an existing one), adds any variable a newer
template introduced, **generates your login password and the other auth
secrets and prints them**, asks your configured LLM endpoint which models it
serves, and then creates the database and applies every migration to it. It
never overwrites a value you set and it asks no questions, so it is safe to
re-run at any time.

There is no step where you go and sign up for something. A checkout with no
credentials runs on `db.sqlite` in the repo root, through Node's own
`node:sqlite` — a real database with the full schema, not a demo mode. Delete
that file to start over.

Then check the machine:

```bash
npm run doctor
```

`doctor` reports the host platform, the paths and CLI binaries the app itself
resolves, which agent runtimes are actually available, the live model list from
`LLM_BASE_URL`, which database provider is active and where its data lives, and
every required variable that is missing — by name. It exits non-zero when the
install cannot work, so it doubles as a CI gate. On a fresh clone it exits 0.

### Which LLM?

Todero talks to one OpenAI-compatible endpoint, set by `LLM_BASE_URL`. Nothing
in the app names a vendor, so this is configuration and not a code change:

| Endpoint | `LLM_BASE_URL` | `LLM_API_KEY` |
|---|---|---|
| Ollama (local, free — the default) | `http://localhost:11434/v1` | not needed |
| LM Studio (local) | `http://localhost:1234/v1` | not needed |
| OpenRouter / Together / Azure / vLLM | as that service documents | required |

For the local default: install [Ollama](https://ollama.com), then
`ollama pull qwen2.5-coder:7b`.

### Which database?

One variable, three adapters, no code change. Left unset, Todero picks the
first one whose credentials are present, and falls back to `sqlite`.

| `TODERO_DB_PROVIDER` | Needs | Use it for |
|---|---|---|
| `sqlite` (default when nothing is set) | nothing | a clone, a laptop, a demo, CI |
| `supabase` | `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | the hosted install |
| `postgres` | `DATABASE_URL` | Neon / Vercel Postgres / RDS / a container |

`npm run db:migrate` applies the right migrations for whichever one is active —
`migrations/sqlite/` for the file, `migrations/` for a Postgres. Adding a fourth
engine is one file under `lib/db/` plus one line in `lib/db/adapters.ts`; the
seam in `lib/db.ts` is proven by `lib/__tests__/db-seam.test.ts`, which runs one
identical query set through all three.

### Running it as a service

`npm start` (after `npm run build`) is the production command on every
platform. Keeping it running is your host's job, not Todero's — systemd on
Linux, a launchd agent on macOS, a scheduled task or NSSM service on Windows.
This repo ships no service definition, because one that assumes a single
operator's home directory is how it stopped being portable in the first place.

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

Every agent spawn runs in its own isolated git worktree under the OS temp
directory (`AGENT_WORKTREE_ROOT` overrides it — run `npm run doctor` to see
where it lands on your machine). Your own checkout is never switched to a
feature branch as a side-effect of a spawn, and parallel agents working on
different issues cannot collide.

- **Created** via `git worktree add -b feat/tod-X`
- **`node_modules` symlinked** from the main repo (no reinstall per spawn)
- **`.next` NOT symlinked** — each worktree builds its own to avoid webpack chunk collisions
- **Teardown** scheduled 60 minutes after spawn
- **Visibility:** `GET /api/run-agent/worktrees` lists active worktrees

The worktree directory is **outside** the checkout, so it is already invisible
to `.gitignore`. No configuration needed.

## Non-negotiable agent rules (enforced in the spawn prompt)

Pipeline agents must:

1. Work inside their assigned worktree, not the shared checkout
2. Commit locally only — **never `git push`**
3. Never run `gh pr create`, `gh pr merge`, `gh pr close`, or `gh pr review`
4. PATCH the issue to its completion status via
   `http://localhost:3000/api/issues` before ending the session
5. Commit format: `feat(TASK-KEY): description [skip ci]`
6. Run `npm run build` before committing (zero TypeScript errors)

PRs are batched at **7am** and **7pm ET** by the operator's own scheduler.
Per-issue PRs are never created.

## Related repos

- **Agent config repo** — agent definitions, memory, skills library and
  operational scripts. Agents load their SOUL/AGENTS/memory from here at spawn
  time. It defaults to `<checkout>/config`; point `TODERO_CONFIG_DIR` at it if
  you keep it elsewhere. `npm run doctor` prints the resolved location.

## Environment

Full annotated list: `.env.local.template`. `npm run setup` copies it,
`npm run doctor` tells you what is still missing. The variables that matter
most:

```bash
# .env.local (not committed)
LLM_BASE_URL=http://localhost:11434/v1   # OpenAI-compatible endpoint
LLM_MODEL=qwen2.5-coder:7b               # blank = first model the endpoint reports
LLM_API_KEY=                             # blank is fine for a local server
NEXT_PUBLIC_SUPABASE_URL=...             # or TODERO_DB_PROVIDER=postgres + DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY=...
MC_PASSWORD=...                          # owner login (has a public default — set it)
MC_VIEWER_PASSWORD=...                   # read-only login
TODERO_RUNTIME=claude-code               # or codex, cursor, openai-api
```

`CLAUDE_BIN` / `CODEX_BIN` / `CURSOR_BIN` are only needed when a CLI is not on
`PATH`; set them to the absolute path on your machine. `npm run doctor` shows
what each one currently resolves to.

## Database migrations

```bash
npm run db:migrate
```

`migrations/` holds SQL files, applied in filename order (`001_...sql`,
`002_...sql`, …) and tracked in a `schema_migrations` ledger, so re-running is
a no-op for anything already applied.

Migrations always run over a **direct** Postgres connection (`DATABASE_URL`),
whichever adapter the app itself uses — an HTTP query layer has no DDL
grammar, so a service-role API key cannot create a table. For a hosted
Postgres, copy the connection URI from your provider's dashboard.
`npm run setup` runs this step for you when `DATABASE_URL` is set, and prints
the manual step when it is not.
