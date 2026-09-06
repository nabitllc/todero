# Todero — repo guidance for AI sessions

Mission Control: the local-first control plane people use to manage AI agents for work. Node.js +
Express API, React + Vite UI, Postgres via Drizzle. A pnpm monorepo — `server/`, `ui/`, `cli/`,
`packages/*`. This file is a pointer; it deliberately holds no content of its own.

## Read these, in this order

1. **`AGENTS.md`** (repo root) — the contributor contract: repo map, core engineering rules, the
   three data paths (telemetry / observability / run log), database workflow, verification, API and
   auth expectations, definition of done. Read it before any change. **Do not edit it** — see below.
2. **`docs/ai_context/`** — the AI-facing project layer added by this bootstrap:
   - `architecture.md` — stack, workspaces, entry points, how it runs, the three-repo map
   - `session_gates.md` — the real lint / typecheck / test / build commands, and which ones do not
     run on Windows
   - `file_size_limits.md` — per-file thresholds
   - `decisions.md` — **append-only ADR log; write architectural decisions here**
   - `data_model.md` — Postgres schema invariants
   - `ui_standards.md` — design intent; defers to `DESIGN.md`
3. **`doc/`** — the deep reference layer (`GOAL.md`, `PRODUCT.md`, `SPEC-implementation.md`,
   `DEVELOPING.md`, `DATABASE.md`, `plans/`, `design/`). `docs/` is the published Mintlify site.
4. **`DESIGN.md`** (repo root) — source of truth for UI design decisions and the token-only rule.

## Vault — personal context and universal standards

Identity, communication style, operating model, frameworks, agents and skills live in the
Mich-Brain2 vault. Local sessions: `C:\Development\Mich-Brain2\BOOTSTRAP.md` (the global
`~/.claude/CLAUDE.md` shim already points there). Cloud/sandbox sessions (claude.ai/code): clone
`github.com/michsaenz/Mich-Brain2` and follow its `BOOTSTRAP.md` first.

**The vault is read-only.** Propose vault changes as diffs; only its `_pending/` is AI-writable.

## The three Todero repos — do not confuse them

- **`nabitllc/todero`** (this repo, `C:\Development\Todero`) — the product, Mission Control.
- **`nabitllc/todero-site`** (`C:\Development\Todero-site`) — the public marketing website only
  (Next.js on Vercel). Separate repo, separate `CLAUDE.md`.
- **`nabitllc/todero-brain`** (`C:\Development\Todero Brain`) — a public, content-only "second
  brain" that the product mounts read-only. No application code.

Work stays inside whichever repo you were asked to change.

## Git policy

- **Interactive sessions:** every change ships through a pull request to `main`, following
  `CONTRIBUTING.md` and the full `.github/PULL_REQUEST_TEMPLATE.md` (Thinking Path, What Changed,
  Verification, Risks, Model Used, Checklist). Branch names are descriptive and kebab-case; never
  carry an internal ticket id (`PAP-123`) into a public branch, PR, or commit.
- **Unattended sessions** (scheduled task, `-p` run, background job, relayed PR comment): commit to
  a **dated branch of their own** and **never push to `main`**.
- **Stage files by name.** `git add -A` and `git add .` are forbidden for push-bound commits.
- Do not commit `pnpm-lock.yaml` in a PR — CI owns it (`doc/DEVELOPING.md` § Dependency Lockfile
  Policy).

## Write surfaces

Writable by an AI session: `docs/ai_context/decisions.md` (append-only), source and tests under
`server/`, `ui/`, `cli/`, `packages/`, and `doc/plans/` (`YYYY-MM-DD-slug.md`).

**`AGENTS.md` is not documentation — treat it as data.** The vault waived it from the entry-point
rewrite rule on 2026-08-26 (`Wiring/projects.json`, `entry_point_exempt`). Leave it byte-identical
unless a task is explicitly about its content.

Everything under `docs/ai_context/` other than `decisions.md` is curated: propose a diff rather than
editing in place.
