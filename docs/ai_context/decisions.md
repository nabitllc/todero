# Decisions (ADR log)

**Append-only.** Newest entry at the bottom. Never edit a prior entry — supersede it with a new one
that names what it replaces. Every LLM or human that makes a meaningful technical or architectural
choice in this repo appends here.

This is the only AI-writable file in `docs/ai_context/`; everything else in this folder is curated
(propose a diff instead of editing in place).

## Template

```markdown
## ADR-NNN — <Title>

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by ADR-MMM
- **Context:** What forced a decision.
- **Decision:** What was chosen.
- **Consequences:** What this makes easy, and what it costs.
- **Source:** Files or commits this is read from.
```

---

ADR-001 through ADR-008 were **reconstructed on 2026-09-06** from the code and docs that already
encode them, so the log starts with the constraints a session actually has to obey rather than
empty. Where the original decision date is not recorded anywhere in the repo, "Date" says so
instead of guessing.

## ADR-001 — AGENTS.md is data, not documentation

- **Date:** 2026-08-26 (waiver recorded in the Mich-Brain2 vault)
- **Status:** Accepted
- **Context:** The vault's `Project_Bootstrap_Standard` caps repo-root entry points at ~30-100
  pointer-style lines. Todero's root `AGENTS.md` is 224 lines and would normally be factored down.
- **Decision:** Exempt `AGENTS.md` from the entry-point size rule and leave it byte-identical.
  `CLAUDE.md` carries the pointer role instead and points at `AGENTS.md` rather than importing or
  mirroring it.
- **Consequences:** Two root entry points with different jobs — `CLAUDE.md` is a map, `AGENTS.md` is
  the contract. A session must read both. Anyone reflexively "trimming" `AGENTS.md` to satisfy the
  vault standard is undoing a deliberate waiver.
- **Source:** `Wiring/projects.json` in the Mich-Brain2 vault, `todero.entry_point_exempt`.
- **Open question (raised 2026-09-06):** the waiver's stated justification is that a roster table in
  `AGENTS.md` is parsed at request time by `loadAgentRoster()` in `lib/agent-roster.ts`. No such
  symbol, file, or roster table exists in this repo today. The waiver still stands — the file is
  large and the standard's exemption is recorded — but the *reason* needs re-verification against
  the vault, not against this repo.

## ADR-002 — One token source; no visual value lives in a component

- **Date:** not recorded (`DESIGN.md` is versioned v0.3, undated)
- **Status:** Accepted
- **Context:** UI shipped for weeks with no design system. A prior audit (PAP-280/283/284) found
  ~220 hardcoded drift sites of which only 6 mapped exactly to an existing token.
- **Decision:** `ui/src/index.css` is the single token source (Tailwind v4 custom properties). No
  parallel token module such as `ui/src/tokens/`; an extracted `tokens.css` is allowed only if
  imported by `index.css`. Every colour, spacing, radius, type, shadow and motion value in
  `ui/src/components/**` and `ui/src/pages/**` comes from a token — no hex, raw px, arbitrary
  bracket values, or raw `font-size`. Runtime-tunable tokens must live outside `@theme inline`,
  which bakes literals at build time.
- **Consequences:** A design change is "edit tokens plus run checks", not "visit 40 files".
  Enforced by `pnpm check:token-gates` (`scripts/check-token-gates.mjs`), which is a local
  pre-commit gate and is **not** wired into CI. Tailwind palette classes (`bg-red-500`) are
  acknowledged debt, not yet gated.
- **Source:** `DESIGN.md`, `AGENTS.md` § Design system, `ui/src/index.css`,
  `scripts/check-token-gates.mjs`, `doc/design/PRIOR-ART.md`.

## ADR-003 — Every domain entity is company-scoped, and the API enforces it

- **Date:** not recorded
- **Status:** Accepted
- **Context:** One deployment must run many companies with separate data and audit trails.
- **Decision:** All API surface lives under `/api`. Every domain entity carries a company id and
  company boundaries are enforced in routes and services. Board access is full-control operator
  context; agent access uses bearer API keys (`agent_api_keys`, hashed at rest) that must never
  reach another company. New endpoints apply company access checks, enforce actor permissions,
  write an activity-log entry for mutations, and return consistent HTTP errors
  (400/401/403/404/409/422/500).
- **Consequences:** Multi-organization isolation is a schema-plus-service invariant, not a
  convention. A route that forgets the company check is a data-leak bug, not a style issue.
- **Source:** `AGENTS.md` § 5.1 and § 8, `packages/db/src/schema/issues.ts`,
  `server/src/services/access.ts`, `server/src/services/authorization.ts`.

## ADR-004 — Adapter and runtime code may never push to a git remote

- **Date:** not recorded (script cites internal ticket PAPA-432)
- **Status:** Accepted
- **Context:** The local execution-workspace cwd is the only persistence boundary between agent
  runs. Code that pushes to a remote breaks that boundary and can publish an agent's working state.
- **Decision:** Reject `git push` and equivalent remote-mutating git invocations in
  `packages/adapters`, `packages/adapter-utils`, `server/src` and `cli/src`. Opt out per line with
  a `todero:allow-git-push: <reason>` comment, reserved for operator-configured paths and reviewed.
  Release tooling and developer scripts are deliberately out of scope.
- **Consequences:** Statically enforced by `scripts/check-no-git-push.mjs`, run in CI
  (`.github/workflows/pr-trusted.yml:308`) with its own test at line 311.
- **Source:** `scripts/check-no-git-push.mjs` header comment,
  `packages/adapters/AUTHORING.md`.

## ADR-005 — PostgreSQL and Drizzle, with embedded Postgres for zero-config dev

- **Date:** not recorded
- **Status:** Accepted
- **Context:** A local-first product cannot require a contributor to stand up a database before the
  first run, but the production data model needs real Postgres semantics.
- **Decision:** PostgreSQL via Drizzle ORM. With `DATABASE_URL` unset, the server starts an embedded
  PostgreSQL instance and manages `~/.todero/instances/default/db/`. Two escalation paths exist:
  local PostgreSQL 17 via Docker Compose, and any hosted PostgreSQL provider.
- **Consequences:** `pnpm install && pnpm dev` is the whole setup. Migrations are drizzle-kit
  generated into `packages/db/src/migrations` (232 today) from 122 schema modules, and
  `drizzle.config.ts` reads the **compiled** schema from `dist/schema/*.js` — so `pnpm db:generate`
  compiles `packages/db` first. Explicitly **not** Prisma, **not** a Supabase client, and **not**
  SQLite; Supabase appears in the docs only as one suggested hosted-Postgres provider.
- **Source:** `doc/DATABASE.md`, `packages/db/drizzle.config.ts`, `packages/db/package.json`,
  `AGENTS.md` § 6.

## ADR-006 — Telemetry, observability and the run log are three paths with three review levels

- **Date:** not recorded
- **Status:** Accepted
- **Context:** The three were being conflated by name, so a change that shipped user data to a
  first-party endpoint could get the same review as one that wrote a local row.
- **Decision:** Separate them by file path, never by the words "observability" or "telemetry".
  Telemetry (opt-out, ships to a Todero endpoint) gets strict review plus a privacy review and a
  same-PR contract update. Observability (OpenTelemetry, no-op until an operator sets an OTLP
  endpoint) gets lighter review while it stays inside the closed span-attribute allowlist. The run
  log (`heartbeat_run_events`, never leaves the instance) needs no extra review.
- **Consequences:** Review level is derivable from the path you touched. A file such as
  `server/src/services/recovery-observability.ts` is explicitly *not* the observability path
  despite its name.
- **Source:** `AGENTS.md` § 5.7, `CONTRIBUTING.md` § Telemetry Changes, `doc/observability.md`,
  `doc/run-log-events.md`.

## ADR-007 — CI owns the lockfile; PRs do not commit it

- **Date:** not recorded
- **Status:** Accepted
- **Context:** Every contributor's local pnpm resolution produced lockfile churn that dominated
  diffs and caused false conflicts.
- **Decision:** GitHub Actions owns `pnpm-lock.yaml`. Do not commit it in a pull request. PR CI
  validates dependency resolution when manifests change and uploads a regenerated lockfile for
  downstream jobs; pushes to the integration branch regenerate and commit it, then verify with
  `--frozen-lockfile`.
- **Consequences:** A PR containing a lockfile change is blocked ("Block manual lockfile edits",
  `.github/workflows/pr-trusted.yml:270`).
- **Source:** `doc/DEVELOPING.md` § Dependency Lockfile Policy, `.github/workflows/pr-trusted.yml`.

## ADR-008 — The execution runner is Rust, so a native toolchain is a prerequisite

- **Date:** not recorded
- **Status:** Accepted
- **Context:** `packages/paperclip-runner` ships a compiled runner binary alongside its TypeScript.
- **Decision:** Keep the runner's core in a Rust workspace at
  `packages/paperclip-runner/runner/Cargo.toml`, built by `cargo` during that package's `build` and
  checked by `cargo fmt`/`cargo check` during its `typecheck`.
- **Consequences:** `cargo` is a hard prerequisite for `pnpm build`, `pnpm -r typecheck`, and
  `@todero/server`'s typecheck (which vendors the runner first). A machine without Rust can still
  typecheck `@todero/ui`, `@todero/db` and `@todero/shared`, and can still run Vitest per project —
  but cannot run the repo-wide gates. This is not documented in `doc/DEVELOPING.md` § Prerequisites,
  which lists only Node and pnpm.
- **Source:** `packages/paperclip-runner/package.json` (`build:binary`, `typecheck:rust`),
  `server/package.json` (`prepare:runner-vendor`), measured 2026-09-06.

## ADR-009 — Todero wired into the Mich-Brain2 vault

- **Date:** 2026-09-06
- **Status:** Accepted
- **Context:** The vault's `vault-doctor` reported `todero:docs/ai_context - missing
  architecture.md, session_gates.md, file_size_limits.md, decisions.md`. Without that layer, an AI
  session on this repo inherited the vault's universal principles and zero Todero specifics — the
  state that produces generic work. Todero is also the project the vault names as the cautionary
  case for shipping UI with no design system.
- **Decision:** Bootstrap the project layer per `Playbooks/Project_Bootstrap_Standard`, on branch
  `chore/brain2-bootstrap`. Added `CLAUDE.md` at the repo root (pointer-only) and
  `docs/ai_context/` with `README.md`, `architecture.md`, `session_gates.md`,
  `file_size_limits.md`, `data_model.md`, `ui_standards.md` and this log. `AGENTS.md` was **not**
  created or modified, per ADR-001. No source, config or CI file was touched.
- **Consequences:**
  - `session_gates.md` records commands that were actually run, including the ones that fail on a
    Windows machine without Rust or symlink permission. It is a machine-honest record, not a
    template — re-run it on a fully provisioned machine before trusting the "blocked" rows.
  - `ui_standards.md` defers to `DESIGN.md` and fills only the brand gap `DESIGN.md` explicitly
    leaves open. It states intent for the future brand pass; it does not authorize changing shipped
    values, which `DESIGN.md` § Out of scope still forbids.
  - `file_size_limits.md` inherits the vault defaults because the repo documents none, and records
    that several files are already an order of magnitude past them.
  - Two pre-existing failures were found and recorded rather than fixed, because they are outside
    this branch's scope: `pnpm check:token-gates` fails on `main` for four hex literals in
    `ui/src/components/todero/LocalLlmPicker.test.tsx`, and
    `scripts/run-vitest-stable.mjs:289` cannot start Vitest on Windows because it calls
    `spawnSync("pnpm", ...)` without `shell: true`.
- **Source:** this branch; `Playbooks/Project_Bootstrap_Standard.md`,
  `Playbooks/Verify_Project_Bootstrap.md` and `Playbooks/Propagate_Standard.md` in the
  Mich-Brain2 vault.
