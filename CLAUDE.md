# Todero — repo guidance for AI sessions

Mission Control: the local-first control plane people use to manage AI agents for work. Node.js +
Express API, React + Vite UI, Postgres via Drizzle. A pnpm monorepo — `server/`, `ui/`, `cli/`,
`packages/*`. This file is a pointer; it deliberately holds no content of its own.

## Read these, in this order

1. **`AGENTS.md`** (repo root) — the runtime-neutral entry point: purpose, read order, and a table
   that names where each rule lives. Like this file, it is a pointer and holds no rule text.
2. **`docs/ai_context/`** — the AI-facing project layer, and where the rules actually live:
   - `architecture.md` — stack, repo map, workspaces, entry points, how it runs, contract
     synchronization, the three-repo map
   - `session_gates.md` — the real lint / typecheck / test / build commands, which ones do not run
     on Windows, when to run what, and the definition of done
   - `file_size_limits.md` — per-file thresholds
   - `decisions.md` — **append-only ADR log; write architectural decisions here**
   - `data_model.md` — Postgres schema invariants, the schema change workflow, the three data paths
   - `ui_standards.md` — design intent and UI working rules; defers to `DESIGN.md`
   - `README.md` — the three layers and the write surfaces
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

**`AGENTS.md` is an entry point, not a rulebook** (ADR-010, which supersedes ADR-001). Keep it
pointer-style and under 100 lines. To change a rule, edit the `docs/ai_context/` file that owns it
and leave the pointer alone.

Everything under `docs/ai_context/` other than `decisions.md` is curated: propose a diff rather than
editing in place.
