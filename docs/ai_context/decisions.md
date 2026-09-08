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

## ADR-010 — AGENTS.md is an entry point again; its rules live in docs/ai_context/

- **Date:** 2026-09-06
- **Status:** Accepted. Supersedes ADR-001.
- **Context:** ADR-001 exempted `AGENTS.md` from the 30-100 line pointer-style entry-point rule and
  told sessions to leave the file byte-identical. The exemption rested on one claim: that a roster
  table inside `AGENTS.md` is parsed at request time by `loadAgentRoster()` in
  `lib/agent-roster.ts`. ADR-001 raised that as an open question on 2026-09-06. It is now answered.
  Grepped the whole repo on 2026-09-06: `loadAgentRoster` returns zero matches, `agent-roster`
  returns zero matches, and no `lib/agent-roster.ts` exists. Nothing in `scripts/`, `server/`,
  `ui/`, `cli/` or `packages/` reads the repo-root `AGENTS.md`. The `"AGENTS.md"` string literals in
  `server/src/services/agent-instructions.ts`, `server/src/services/built-in-agents.ts` and
  `server/src/services/company-portability.ts` name the entry file of an *agent instructions
  bundle* inside a company package — a different file at a different path, and unrelated to the
  repo-root contributor guide. So `AGENTS.md` is documentation after all, and it was 224 lines that
  every AI session in every clone of this open-source repo loaded eagerly.
- **Decision:** Withdraw the exemption. Factor `AGENTS.md` down to a pointer-style entry point of
  under 100 lines: the purpose statement, the read order, a table that names where each rule lives,
  the design-system rule, and the pull-request rule. Move every rule out of it, verbatim in meaning,
  into the file that already owns that subject:
  - repo map and contract synchronization to `architecture.md`
  - control-plane invariants, the database change workflow and the three data paths to
    `data_model.md`
  - verification policy, the definition of done and the progress-log rule to `session_gates.md`
  - UI expectations to `ui_standards.md`
  - strategic docs, plan documents and generated artifacts to this folder's `README.md`
- **Consequences:**
  - One rule has one home. A rule that lived in two files can no longer drift between them.
  - `AGENTS.md` and `CLAUDE.md` now have the same job and the same shape. Neither holds rule text.
  - Live cross-references of the form `AGENTS.md` § N are gone. Those numbers were brittle: a
    section number changes whenever a section is added. What remains are provenance notes — the
    "moved here from § N" lines, and the `Source:` lines of ADR-002 through ADR-006, which record
    where a rule came from and are not edited because this log is append-only.
  - Contributors who cloned this repo read a shorter entry point that stands on its own. It points
    only at files in this repository.
  - Anyone who trims `AGENTS.md` further must move the content, not delete it.
  - One stale gate result was corrected on the way through. ADR-009 and `session_gates.md` recorded
    `pnpm check:token-gates` as a standing failure on `main`. Re-run on `origin/main` at `d9132fe5`
    on 2026-09-06: all four gates clean, 34 allowlist entries loaded. Commit `fb75d94c` (PR #45)
    had already allowlisted the four `LocalLlmPicker.test.tsx` literals at `ui/src/index.css:2496`,
    and `fb75d94c` is an ancestor of `main`. ADR-009 is not edited, because this log is append-only;
    this entry supersedes that one observation only.
- **Source:** this branch; `AGENTS.md` at commit `d9132fe5` (224 lines) for the content moved.

## ADR-011 — Pull request checks run a cheap lane by default; the full matrix needs the `full-ci` label

- **Date:** 2026-09-07
- **Status:** Accepted
- **Context:** `pr-trusted.yml` runs 22 jobs per push, about 100 runner minutes, on a private
  repository with 2,000 free minutes a month. Nine pull requests and their re-pushes after the
  2026-08-29 fresh start used the whole allowance by 2026-09-07; GitHub then refused to start any
  job ("spending limit needs to be increased"), and PR #48, a 2,000-line change to migration
  reconciliation, merged with no check run at all. Twenty Dependabot pull requests arrived the same
  morning (grouped by PR #72). Measured on the last green run (34076033605): general tests 8 shards
  at 6-8 min, serialized server suites 5 at 5 min, e2e 3 at 4-5 min, build 4 min, typecheck 3 min,
  policy under 1 min.
- **Decision:** The scope step in the `gate` job sets `full_ci=false` unless the pull request
  carries the `full-ci` label. `policy`, `typecheck_release_registry` and `build` run on every pull
  request (about 8 minutes). `general_tests`, `verify_serialized_server` and `e2e_shards` run only
  with the label. `pr.yml` adds the `labeled` event type so applying the label starts the run
  without a new push. The `verify` aggregate requires typecheck and build to succeed on both lanes
  and general tests only on the full lane. The stacked-PR scope logic is kept, behind the label.
  The rule for contributors is in `CONTRIBUTING.md` § Todero Gates Must Pass: label any change
  under `server/`, `ui/`, `cli/` or `packages/` before merge.
- **Consequences:**
  - About 200 cheap-lane runs a month fit in the free allowance, against 20 full runs before.
  - A code change merged without the label has no test evidence from CI. The label is a human
    step, so the PR template checklist and the reviewer are the enforcement. Making the repository
    public would remove the cost problem entirely (Actions minutes are free on public
    repositories) and is the intended end state; it waits on rotating an old service key that
    still sits in the history of `origin/archive/2026-08-29-carcass`.
  - `scripts/__tests__/e2e-shard.test.mjs` asserts the new shape: typecheck and build ungated,
    tests and e2e gated, `verify` expecting success from typecheck and build on the cheap lane.
- **Source:** this branch; billing page of the `nabitllc` organization on 2026-09-07 (2,000 of
  2,000 minutes used, reset in 24 days); PR #72 for the Dependabot half of the fix.

## ADR-012 — A chat-only local LLM converses through the ticket thread and hands back a status line

- **Date:** 2026-09-08
- **Status:** Accepted
- **Context:** The wizard hires a local Ollama model as an `http` agent pointed at an
  OpenAI-style `/v1/chat/completions` URL. Such an agent has no tools: it cannot check out work,
  post comments, or set a disposition through the API. Before this decision the heartbeat sent it
  only the task description, so every reply restarted the conversation; the run then left the
  issue `in_progress`, so the missing-disposition recovery blocked the task after one attempt;
  the work-item view hid any reply over 140 characters behind a "summary was N characters" line;
  and the ticket comment cap cut a plan off at 1,200 characters. The only run on the reference
  machine (2026-08-30) stalled on exactly this chain. Two pre-existing defects were found on the
  way: the live dev database still carried four columns the code had dropped (the 2026-09-06
  migration reconcile stamped them as applied), and the bundled Todero skill check threw when the
  seeded snapshot differed from the registry after the rebrand, which failed every run.
- **Decision:** For an `http` agent whose URL ends in `/v1/chat/completions`, the heartbeat loads
  the last 20 human/agent comments on the issue (system notices excluded) into the run context
  as `toderoThread`. The adapter sends a system prompt (agent name, no tools, terse, end with a
  status line), the task markdown, then the thread as alternating user/assistant turns; same-side
  turns are merged and a user nudge is appended when the thread ends with the agent, because a
  transcript that ends in the assistant's own turn returns an empty completion. The reply's
  trailing `STATUS: done` or `STATUS: waiting` line is stripped and stored as
  `resultJson.toderoDisposition`. After the comment is posted, the heartbeat applies it:
  `done` closes the issue, `waiting` (also the default) moves it to `blocked` with the
  `<!-- todero-blocked-by: waiting-on-you -->` description marker, the state the work-item view
  renders as "Blocked · Waiting on you." and the state a later user comment wakes from. Agent
  replies render in full in the work-item view. The ticket comment cap is 12,000 characters. The
  wizard's local LLM timeout is 180 seconds. A drifted bundled skill snapshot is refreshed from
  the registry with a warning instead of throwing.
- **Consequences:**
  - One agent on Ollama now goes from hire to a plan to done with no cloud model, and a user
    reply on the ticket continues the conversation.
  - The work-item view's one-line agent summary rule is gone; replies are the conversation. The
    reply body is shown as plain text, not rendered Markdown, which is a follow-up.
  - The first-task description still instructs the agent to use `request_checkbox_confirmation`
    and a plan document it cannot produce; the plan approval card is separate work.
  - Small models sometimes omit the status line; the default of `waiting` keeps the task in the
    person's hands rather than silently done.
  - A dev database seeded before the migration reconcile may need the same four-column repair
    applied by hand; the reconcile marks it current and will not fix it.
- **Source:** `server/src/adapters/http/chat-completions.ts`, `server/src/todero/conversation-thread.ts`,
  `server/src/services/heartbeat.ts` (thread context and disposition), `server/src/services/company-skills.ts`
  (snapshot refresh), `server/src/services/heartbeat-run-summary.ts` (comment cap),
  `ui/src/components/work-item/WorkItemView.tsx`, `ui/src/components/OnboardingWizard.tsx`.
