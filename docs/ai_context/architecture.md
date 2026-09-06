# Architecture

Project layer for Todero (Mission Control). Universal standards live in the Mich-Brain2 vault;
this file holds only what is true of this repo. Read alongside `AGENTS.md` § 3 (Repo Map) — that
table is the canonical repo map and this file does not restate it in full.

## What this is

A local-first control plane for organizations of AI agents: org charts, tasks, heartbeat runs,
budgets, approvals, governance and audit logs (`README.md`, `doc/GOAL.md`, `doc/PRODUCT.md`). The
concrete build contract is `doc/SPEC-implementation.md`; `doc/SPEC.md` is long-horizon context.

## Stack

| Layer | Choice | Where |
|---|---|---|
| Runtime | Node.js `>=24.11.0` | `package.json` § `engines` |
| Package manager | pnpm `9.15.4`, workspaces | `package.json` § `packageManager`, `pnpm-workspace.yaml` |
| Language | TypeScript `^7.0.2`, ESM (`"type": "module"`) | root `package.json` |
| API | Express REST under `/api` | `server/`, `AGENTS.md` § 8 |
| UI | React 19 + Vite, Tailwind v4, shadcn primitives | `ui/`, `ui/src/index.css` |
| Database | PostgreSQL via Drizzle ORM `^0.45.2` | `packages/db/`, `packages/db/drizzle.config.ts` |
| Embedded DB | `embedded-postgres` (dev, zero-config) | `packages/db/package.json`, `doc/DATABASE.md` |
| Tests | Vitest `^4.1.10` (unit), Playwright `^1.62.1` (e2e, Storybook visual) | `vitest.config.ts`, `tests/` |
| Component docs | Storybook | `ui/storybook/` |
| Native | Rust (`cargo`) for the runner binary | `packages/paperclip-runner/runner/Cargo.toml` |

There is **no ESLint and no Prettier** in this repo — no config file exists and no workspace defines
a `lint` script. What plays the lint role is a set of deterministic check scripts; see
`session_gates.md`.

## Workspaces

`pnpm-workspace.yaml` includes `packages/*`, `packages/adapters/*`, `packages/plugins/*`,
`packages/plugins/examples/*`, `server`, `ui`, `cli` — with `packages/plugins/sandbox-providers/**`
and `packages/plugins/examples/plugin-orchestration-smoke-example` deliberately excluded so they
stay installable standalone without churning the root lockfile.

Beyond the map in `AGENTS.md` § 3, worth knowing:

- `packages/adapters/*` — one package per agent runtime (`claude-local`, `codex-local`,
  `cursor-local`, `cursor-cloud`, `gemini-local`, `grok-local`, `kimi-local`, `opencode-local`,
  `pi-local`, `hermes`, `hermes-gateway`, `openclaw-gateway`). Authoring rules:
  `packages/adapters/AUTHORING.md`.
- `packages/paperclip-runner` — the execution runner; TypeScript plus a Rust workspace under
  `runner/`. This is the one package that needs a native toolchain.
- `packages/skills-catalog`, `packages/teams-catalog` — app-shipped catalogs.
- `skills/` (repo root) — Todero's own runtime/operational skills, *not* the app catalog.

## Entry points

| Entry | File |
|---|---|
| API server | `server/src/index.ts` (app wiring in `server/src/app.ts`) |
| Web UI | `ui/src/main.tsx` |
| CLI (`todero`) | `cli/src/index.ts` |
| Drizzle schema | `packages/db/src/schema/index.ts` |
| Design tokens | `ui/src/index.css` |

## How it runs

Zero-config dev: leave `DATABASE_URL` unset and the server starts embedded PostgreSQL itself.

```
pnpm install
pnpm dev
```

Both the API and the UI are served from `http://localhost:3100` — in dev the API server hosts the
UI through Vite middleware (`AGENTS.md` § 4). Health check: `GET /api/health`.

Data persists in `~/.todero/instances/default/db/`; deleting that directory resets local dev
(`doc/DATABASE.md` § 1). Two other modes exist: local PostgreSQL 17 via `docker compose up -d`, and
hosted PostgreSQL — `doc/DATABASE.md` § 2 and § 3.

Agents do not run continuously. They run in **heartbeats**: short execution windows triggered by a
wakeup (`docs/agents-runtime.md` § 1). The append path is `appendRunEvent` in
`server/src/services/heartbeat.ts`.

## The three Todero repos

| Repo | Local path | What it is |
|---|---|---|
| `nabitllc/todero` | `C:\Development\Todero` | **This repo.** The product, Mission Control. |
| `nabitllc/todero-site` | `C:\Development\Todero-site` | The public marketing website only (Next.js on Vercel). |
| `nabitllc/todero-brain` | `C:\Development\Todero Brain` | A public, content-only "second brain" the product mounts read-only. No application code. |

Registered in the vault at `Wiring/projects.json`. Keep changes inside the repo you were asked to
change; the other two are separate checkouts with separate review.

## Deeper docs — point here rather than duplicating

- `doc/SPEC-implementation.md` — the V1 build contract
- `doc/DEVELOPING.md` — prerequisites, dev start, lockfile policy
- `doc/DATABASE.md` — the three database modes
- `doc/DEPLOYMENT-MODES.md` — `local_trusted` / `authenticated`, private vs public exposure
- `doc/plugins/PLUGIN_SPEC.md` — the extension surface; the preferred path for new capability
- `doc/connections/CONNECTOR-PLAYBOOK.md` — canonical runbook for Apps catalog connections
- `doc/observability.md`, `doc/run-log-events.md` — two of the three data paths (`AGENTS.md` § 5.7)
- `doc/AGENT-ARTIFACTS.md` — how generated deliverables are attached
- `docs/agents-runtime.md`, `docs/built-in-agents.md` — heartbeat runtime and first-party agents
- `docs/docs.json` — the published Mintlify site index
