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

## ADR-013 — Finished work passes a reviewer agent, and each organization decides whether a pass closes the task

- **Date:** 2026-09-10
- **Status:** Accepted
- **Context:** A chat-only local model closes its own task the moment it writes `STATUS: done`.
  Nothing reads the work first, so a half-finished draft unblocks the next task in the chain and
  the person only finds out at the end. The answer is a second opinion from the same local model,
  plus a switch that says whether a person still has to look.
- **Decision:** When a child task of an approved plan hands in, the heartbeat runs one more chat
  completion against a **reviewer agent**: a real agent record hired on the first plan approval,
  named `<lead>'s reviewer`, on the same adapter config as the worker, found again by a
  `metadata.toderoJudge.forAgentId` marker. The prompt is the feature's `done_when` line from the
  parent's Plan document, what the task said it would hand in, and the reply itself; the answer is
  `VERDICT: pass|fail` plus one paragraph. The reviewer sits inside the Wave C review gate: it runs
  only for a hand-in `planConversationOutcome` already routed to `review`, and only its "accept"
  changes where the task lands. A pass is accepted for the person when the organization's
  `autoAcceptWhenJudgePasses` setting is on, and handed to them as "Waiting on you" when it is off
  — which is the default, so nobody gives up reviewing their own finished work without turning the
  switch on. A fail posts the paragraph as a comment from the reviewer, puts
  the task back to To do and wakes the worker, at most twice — counted in the description as
  `<!-- todero-judge-rounds: N -->` — after which the person decides. A reviewer that cannot be
  reached, or a reply with no verdict in it, changes nothing.
- **Consequences:**
  - The switch lives on the company's existing `interaction_resolver_governance` JSON, so there is
    no migration. Anything else that wants a company-level flag adds a key there rather than
    reshaping the object.
  - The reviewer's verdict is a comment authored by the reviewer agent, not a heartbeat run of its
    own: starting a run for a second agent on a task it never checked out would have to go through
    the whole execution path. The audit trail is the comment.
  - The conversation thread now labels another agent's comments as the other side of the
    conversation, so the worker reads the reviewer's paragraph as feedback rather than as its own
    words.
  - At most two extra model calls per task on a laptop GPU, and none at all for a company that has
    never approved a plan.
  - A task Todero closes on the person's behalf does not go through the PATCH route, so the two
    wakes that route raises after a close — the task queued behind it, and the parent's wrap-up
    once every task under it is closed — now live in `server/src/services/issue-closed-wakeups.ts`
    and are raised from the heartbeat. The route keeps its own batched copy for now; the helper is
    written with injected dependencies so it can adopt it.
- **Source:** `server/src/todero/judge.ts`, `server/src/todero/judge-review.ts`,
  `server/src/todero/judge-apply.ts`, `server/src/todero/judge-agent.ts`,
  `server/src/todero/conversation-outcome.ts` (`planReviewedOutcome`),
  `server/src/services/issue-closed-wakeups.ts`,
  `server/src/services/heartbeat.ts` (the conversational disposition block),
  `server/src/routes/todero-plan-routes.ts`, `packages/shared/src/types/company.ts`,
  `ui/src/pages/CompanySettings.tsx`.

## ADR-014 — Local model routing and orchestration rules are data

- **Date:** 2026-09-10
- **Status:** Accepted
- **Context:** Which local model answers a turn, and how many workers or judge passes run, were
  either hardcoded one call site at a time or not decided anywhere yet. A machine serving more
  than one model size (a strongest-available class alongside a small fast one) had no place to
  express "use the bigger one for planning, the smallest for reformatting."
- **Decision:** `server/src/todero/model-routing.ts` holds a table from task kind (`planning`,
  `judging`, `drafting`, `wrap-up`, `formatting`) to a preference order of model classes
  (`strongest_local` = 12-16B parsed from the model id, `fastest_local` = smallest parsed size,
  `wizard_default` = the agent's configured model). `pickModelForKind` resolves the first class
  that matches a model in the list the local-llm detect endpoint reports, falling back to the
  default. `chat-completions.ts`'s `buildChatCompletionsBody` calls it via `context.toderoTaskKind`,
  which the heartbeat sets to `planning` for the standing conversation task, `drafting` for a task
  with a parent, and `wrap-up` when a closing turn instruction is present; the chosen model is
  recorded as `resultJson.toderoModel`. Separately, `server/src/todero/orchestration-rules.json` +
  `orchestration-rules.ts` hold `judgeAfterFirstPlan`, `extraWorkerWhenReadyTasksAbove`,
  `neverMoreAgentsThanModelsServed`, `maxJudgeRounds`, and `busyTimerSec` as one file with a
  tolerant loader (missing file, bad JSON, or a wrong-typed field all fall back to the built-in
  defaults field-by-field). Nothing reads the orchestration rules yet: the file landed alongside
  the first version of the reviewer (ADR-013) and of the second
  worker, and its numbers are not yet the ones those two read.
- **Consequences:**
  - Adding a model class or a task kind is a table edit, not a new `if` at a call site.
  - The rules file has no consumer yet; a future wave points `heartbeat.ts` /
    `issues.ts` to it instead of inventing another local constant. The reviewer (ADR-013) and the
    second worker each still carry their own numbers today.
  - `context.toderoAvailableModels` (the list `pickModelForKind` ranks) is not populated by the
    heartbeat yet, since no wave threads a live detect result into run context; until it is,
    routing always falls through to the default model, which matches today's behavior exactly.
- **Source:** `server/src/todero/model-routing.ts`, `server/src/todero/orchestration-rules.ts`,
  `server/src/todero/orchestration-rules.json`, `server/src/adapters/http/chat-completions.ts`,
  `server/src/adapters/http/execute.ts`, `server/src/services/heartbeat.ts`.

## ADR-015 — The Board is a second board component, not a mapping over `KanbanBoard`

- **Date:** 2026-09-11
- **Status:** Accepted
- **Context:** The Board wave's own brief said the new page "reuses `KanbanBoard` with the mapping
  below rather than forking it". `ui/src/components/KanbanBoard.tsx` is keyed to raw `IssueStatus`
  at every level: `boardStatuses` is a list of statuses, each column registers its droppable with
  `useDroppable({ id: status })`, a drop calls `onUpdateIssue(id, { status })`, and the column tones
  are a `Partial<Record<IssueStatus, …>>`. The new page is a different shape — rows (one per feature
  goal) crossed with five *turn* columns that are computed from `turnSentence`, not from a status;
  a drop asks a question and calls Accept / Start now / Park; the Agent working header carries a
  per-agent work-in-progress badge. Reaching that through `KanbanBoard`'s props means replacing its
  column model, its droppable ids, its drop handler and its header — inside a file that is already
  502 lines, past the 400-line hard cap for a component, and owned by the Tasks page's board mode.
- **Decision:** `ui/src/pages/Board.tsx` plus `ui/src/components/board/*` is a second board
  component. It reuses the same `@dnd-kit` primitives and the same card language, and — more
  importantly — reuses the product logic that matters: `turnSentence` (through `columnFor` and
  `reviewerHasIt`), the goals data, the task page's own API calls and `patchFromBlockedBy`.
  `KanbanBoard` is untouched; the Tasks board mode keeps working exactly as it did.
- **Consequences:**
  - Two board components exist. A change to card chrome has to be made twice, and a third view
    (the manager wave) should extract the shared card rather than adding a third copy.
  - `KanbanBoard` does not grow, and the Tasks page carries no risk from this wave.
  - The rows × turn-columns model stays free to change without negotiating with a status-keyed
    component that a different page owns.
  - If the two boards are ever merged, the merge is the planned refactor `file_size_limits.md`
    describes for an outlier file, with its own PR — not a side effect of a feature wave.
- **Source:** `ui/src/components/KanbanBoard.tsx`, `ui/src/pages/Board.tsx`,
  `ui/src/components/board/`, `ui/src/lib/board-model.ts`.

## ADR-016 — Todero sets the local model's window and budgets the prompt against it

- **Date:** 2026-09-14
- **Status:** Accepted
- **Context:** A local model is served with a fixed context window. When the prompt is longer than
  the window the runtime drops the front of it — exactly where the system prompt and the format
  instructions sit. That is the mechanism behind the observed failure: an agent on
  `qwen2.5-coder:14b` produced a fenced `todero-plan` block early in a thread and, by comment 40,
  only produced "Do you approve this plan?" with no block at all. Two earlier organizations the
  same day, same model, same prompts, did produce it. Nothing on Todero's side knew the window:
  `toderoLocalLlmContextLength` was recorded only when a connection test happened to name an
  organization, was read only to size the skill pack, and no request ever asked for a window, so
  Ollama's 4,096-token default applied whatever the model could hold.
- **Decision:** Three parts, all on the local-model path only.
  1. The window is resolved per run (`resolveContextLengthForRun`): the recorded value, or — for an
     organization hired before it was kept, or whose connection test ran before the organization
     existed — one look at the runtime, remembered for next time. `detectContextLength` now falls
     back from `/api/ps` (which lists only loaded models) to `/api/show`, so a cold runtime can
     still answer. The heartbeat puts the result on the run context as `toderoContextLength`.
  2. The request asks for that window. Measured against Ollama 0.34.0, the OpenAI-shaped endpoint
     at `/v1/chat/completions` **ignores** `options.num_ctx` — a request carrying 16,384 still
     loaded the model at 4,096 — while Ollama's own `/api/chat` honours it (the model loaded at
     16,384). So when, and only when, a window is known and the endpoint is Ollama, the http
     adapter posts the same conversation to `/api/chat` with `options.num_ctx` and reads the native
     reply. With no recorded window nothing changes: the request stays OpenAI-shaped and the
     runtime keeps deciding. Todero never invents a window, and never asks for more than 16,384
     tokens (`MAX_REQUESTED_CONTEXT_LENGTH`, the window the wizard already recommends): what a
     model was built with — 128k for some, which is what `/api/show` reports — is not what the
     machine can serve.
  3. The prompt is budgeted against the window before it is sent
     (`server/src/adapters/http/prompt-budget.ts`). The opening block — who the agent is, what it
     knows, and the task, which is where the format instructions live — is pinned and always
     survives, as does Todero's instruction for the turn. The conversation in the middle is trimmed
     oldest-first and the pinned block says how many messages were left out.
- **Consequences:**
  - Format instructions can no longer lose a fight with old chat history: the trim is Todero's,
    not the runtime's, and it takes from the end that matters least.
  - Local Ollama agents with a recorded window talk to a different endpoint than before. The reply
    shape (`message.content`, `done_reason`) is translated in one small module; a runtime that is
    not Ollama, and any agent with no recorded window, is untouched.
  - Raising `OLLAMA_CONTEXT_LENGTH` is no longer the only way to give an agent a bigger window,
    but a recorded window still comes from what the runtime reports, so the wizard's hint stands.
  - The chars-per-token estimate is one number (`CONTEXT_CHARS_PER_TOKEN` in `@todero/shared`),
    shared by the skill-pack ceiling and the prompt budget.
- **Source:** `server/src/adapters/http/prompt-budget.ts`, `server/src/adapters/http/ollama-native.ts`,
  `server/src/adapters/http/chat-completions.ts`, `server/src/adapters/http/execute.ts`,
  `server/src/todero/available-models.ts`, `server/src/services/heartbeat.ts`,
  `packages/shared/src/skill-pack-utils.ts`.

## ADR-017 — Where a runtime can enforce the plan's shape, Todero makes it, instead of asking

- **Date:** 2026-09-14
- **Status:** Accepted
- **Context:** `TODERO_PLAN_BLOCK_INSTRUCTIONS` describes the fenced `todero-plan` block in words
  and hopes the model writes one. Observed on this machine (company `abb1b283`, issue `d12f7298`):
  `qwen2.5-coder:14b` on Ollama answered "Do you approve this plan?" fifteen times in four minutes
  and never wrote a block, so `parseToderoPlanBlock` found nothing, the description never got the
  pending marker, the app never offered Approve, and the task dead-ended. Two earlier organizations
  the same day, same model, same prompts, wrote the block. Words are not a mechanism; a schema is.
  ADR-016 gave the model a window big enough to still see the instructions. This makes the shape
  something it cannot miss.
- **Decision:** On the one turn where Todero itself asks for the plan — the corrective turn from
  `buildMissingPlanRetryInstruction` — and only against Ollama, the request carries a JSON schema
  for the plan (`TODERO_PLAN_JSON_SCHEMA`): `response_format: { type: "json_schema" }` on the
  OpenAI-shaped endpoint, the bare schema in `format` on Ollama's own `/api/chat`. What comes back
  is rewritten into the reply Todero already reads — the words for the person, the canonical fenced
  block, the status line — so nothing downstream changes. Scope is deliberately narrow on two axes:
  1. **Only that turn.** A schema constrains the whole reply, so a conversational turn carrying one
     would answer the person in JSON. The signal is Todero's own turn instruction naming the fence,
     never the task description, which carries the template for the life of the conversation.
  2. **Only Ollama.** It is the endpoint Todero can be sure reads a schema. Everywhere else the
     request goes out exactly as it does today.
  The prose path stays the fallback: if the runtime ignores the schema or answers with a fenced
  block anyway, `parseToderoPlanBlock` reads it as before. The run records which path produced the
  plan — `resultJson.toderoStructuredPlan`, plus a line in the run log.
- **Consequences:**
  - The loop this branch is about now has an end: a model that will not write a block is made to.
    Measured against Ollama 0.34.0 with `qwen2.5-coder:14b`, both endpoints honoured the schema and
    returned a usable plan.
  - The two organizations that already worked are untouched: they never reach the corrective turn,
    and an ordinary turn carries no schema.
  - The plan shape now has two statements — the prose template and the schema. They must be changed
    together; both live next to each other in `packages/shared/src/todero-plan*.ts`.
  - Any later endpoint that advertises `response_format` support can be added to the one predicate
    in `structured-plan.ts` without touching anything else.
- **Source:** `packages/shared/src/todero-plan-schema.ts`,
  `server/src/adapters/http/structured-plan.ts`, `server/src/adapters/http/execute.ts`,
  `server/src/adapters/http/chat-completions.ts`, `server/src/adapters/http/ollama-native.ts`.

## ADR-018 — The recorded window is what the model can hold, not what it is loaded at

- **Date:** 2026-09-14
- **Status:** Accepted (amends ADR-016, parts 1 and 2)
- **Context:** ADR-016 read the window by asking Ollama's `/api/ps` first and only falling back to
  `/api/show`. The two endpoints answer different questions: `/api/ps` reports the window the model
  is **loaded** at — Ollama's 4,096 default unless someone set otherwise — while `/api/show`
  reports what the model can **hold**, 32,768 for `qwen2.5-coder:14b`. Both were observed on this
  machine minutes apart for that model. Because ADR-016 preferred the loaded reading, any
  organization whose window was filled in while the model happened to be warm recorded 4,096 —
  and, now that Todero actively sets `num_ctx` and trims the prompt, went on to force the model to
  one eighth of what it holds, for good. That is worse than the pre-ADR-016 behaviour it replaced.
  All five organizations in the first live run recorded 4,096 this way.
- **Decision:**
  1. `detectContextLength` asks both endpoints at once and takes the larger. `/api/show` is the
     capability and is never lowered by a loaded-state snapshot; `/api/ps` still counts, but only
     for a row naming **the model being asked about**, because a model deliberately loaded above
     its own reported maximum really is serving that window. There is no "whatever is loaded"
     fallback: one Ollama here serves eight models and routing switches model per turn, so the row
     on top is routinely a different model's, and a reading taken from it would be ratcheted in
     permanently by parts 2 and 3. Observed on this machine with only `ornith:9b` loaded at 65,536:
     the fallback recorded 65,536 for `qwen2.5-coder:14b`; without it, 32,768.
  2. `storeContextLength` only ever moves upward. A reading can be an understatement, and an
     understatement that overwrites a known capability is permanent.
  3. `resolveContextLengthForRun` does not trust a recorded window on sight: the first run that
     can reach the runtime re-checks it and keeps the larger number, which repairs every
     organization already holding 4,096 on its next turn, with no migration. That check happens
     **once**, marked by `toderoLocalLlmContextLengthRechecked`; the model's own maximum does not
     change between turns, and the earlier rule — re-check anything below the ceiling — meant an
     8k or 4k model paid two localhost requests every turn forever. A run that reaches nothing
     records nothing and asks again next turn. A later connection test still raises the number.
     This is also why the domain layer no longer imports the ceiling from the http adapter: "when
     to stop re-probing" and "the largest window we request" are different questions.
  4. `MAX_REQUESTED_CONTEXT_LENGTH` rises from 16,384 to 32,768. 16,384 was the wizard's comfort
     recommendation, not a hardware limit, and it would have capped the model Todero is actually
     run with to half of what it holds. What 32k costs was then measured rather than assumed: at
     `num_ctx` 32768 this machine's Ollama reports `qwen2.5-coder:14b` at 15.7 GB with 10.5 GB
     resident on a 12 GB card, so roughly five gigabytes spill to system RAM. That price is
     accepted knowingly — the alternative on the table was every organization running at 4,096,
     which is not slower but broken — while 128k, what `/api/show` reports for some models, would
     spill several times as much, so a ceiling stays.
- **Consequences:**
  - An organization recorded at 4,096 repairs itself on the next turn: one extra pair of localhost
    requests, once, and none after that.
  - Todero can now ask a machine for 32,768 tokens where it previously asked for 16,384. Someone
    serving a window larger than 32k is still trimmed to 32k and loses room, not capability.
  - The number Todero acts on is the same one it records, so the request and the prompt budget
    still cannot disagree.
- **Source:** `server/src/todero/available-models.ts`,
  `server/src/adapters/http/prompt-budget.ts`.

## ADR-019 — A shaped reply that is not a plan is answered in words, and the path is on the run

- **Date:** 2026-09-14
- **Status:** Accepted (amends ADR-017)
- **Context:** ADR-017 asks Ollama to hold the corrective turn to the plan's schema and reads the
  object back out. A runtime can honour the schema and still return something
  `parseToderoPlanJson` rejects: the wrong shape, an empty `features`/`tasks`, or an object cut
  off mid-write when `num_predict` ran out. The reply then fell through to the prose path, and the
  prose path posts whatever it was given — so the person got the raw JSON blob as the agent's
  message. Reproduced live in a "Zz Recover" organization: the ticket comment was a literal JSON
  string. Before ADR-017 that same turn produced prose. ADR-017 also said the run records which
  path produced the plan, but `toderoStructuredPlan` only reached `resultJson`, and the run-list
  projection keeps a whitelist, so the fact never left the run log.
- **Decision:**
  1. When the turn asked for the shape and the reply is an attempt at the object but not a usable
     plan, the person is shown the object's own `message`, or one plain sentence when it carries
     no words. Never the JSON. A truncated object never parses, so the words are lifted out of
     the `message` field directly — it is the first field the schema asks for, so it is usually
     written before the room runs out. A reply that was never an attempt at the object (prose,
     with or without a fenced block) is untouched and reads exactly as before.
  2. `resultJson.toderoStructuredPlan` is one of three words rather than a boolean: `held` (the
     runtime held the shape), `prose` (it answered in prose and the fenced parser read it), or
     `unreadable` (the shape came back and did not hold). The third is the case this ADR is
     about, and a boolean could not say it.
  3. That value travels with the run the way the summary and cost fields do — a projected column
     in `heartbeatRunListResultColumns` and a field in `summarizeHeartbeatRunListResultJson` — so
     `GET /api/companies/:companyId/heartbeat-runs` carries it, not just the single-run fetch.
     No new mechanism: this is the same whitelist every other per-run fact goes through.
- **Consequences:**
  - The worst outcome of asking for a schema is now a plain sentence, which is what the turn
    produced before ADR-017. It can no longer be a JSON blob in a person's thread.
  - A three-word value is a contract: anything reading `toderoStructuredPlan` as a boolean would
    now see a truthy string. Only the http adapter writes it, and only this branch read it.
- **Source:** `server/src/adapters/http/structured-plan.ts`,
  `packages/shared/src/todero-plan-schema.ts`, `server/src/services/heartbeat.ts`.

## ADR-020 — The JSON is removed from the reply, not the reply from the person

- **Date:** 2026-09-14
- **Status:** Accepted (amends ADR-019)
- **Context:** ADR-019 decided that a shaped reply which is not a usable plan is answered in
  words. It carried that out by asking whether the *whole* reply was an attempt at the object —
  the trimmed text had to start with `{`. Three things that actually happen fall outside that
  test, and review caught all three. A reply with a sentence in front of the object
  (`Sure, here is the plan:` then the object) and a reply that is a top-level array both fell
  through to the prose path, which posts what it was given: the blob, verbatim, exactly the
  outcome ADR-019 exists to prevent. Its consequence line "It can no longer be a JSON blob in a
  person's thread" was therefore false. Worse, the same test threw prose away: a fence check that
  was not anchored classed any prose *containing* a ```json block as unreadable and replaced the
  model's own words with the canned sentence. And the live reply that motivated ADR-019 (run
  `6752efd3`, "Zz Recover") was read by neither path: its words are under `body` and a complete,
  recoverable plan sits under `plan`, so the person got the canned sentence and the loop the work
  exists to break repeated. That reply also violates the strict schema it was sent with, which is
  the evidence that this runtime does not hard-enforce output on this path — so "the reply starts
  with `{`" was never a safe assumption.
- **Decision:**
  1. Find the JSON *anywhere in the reply* — the reader walks the text, honouring strings and
     escapes, and returns every blob with its span: bare or fenced, object or array, closed or
     cut off. This is the shape the sibling reader already documented as one that happens.
  2. Replace the blob, not the reply. Each blob becomes its own words; everything the model
     wrote around it is kept. A status line in that kept prose is dropped — Todero appends the
     one status a plan turn is entitled to, and a stray `STATUS: done` beside an unusable object
     must not close the task. One plain sentence only when there were no words anywhere.
  3. Read `body` as well as `message`, and a plan filed one level down under `plan`, so the
     "Zz Recover" reply yields the model's own sentence and its recoverable plan.
  4. A person sees the path in Mission Control: `RunStructuredPlanNote` renders
     `resultJson.toderoStructuredPlan` on the run detail. ADR-019 claimed the run-detail panel
     already printed `resultJson`; it prints it only for a failed or timed-out run, and a turn
     whose shape did not hold exits 0.
- **Consequences:**
  - The reader is deliberately greedy on a turn that asked for the shape: `{"` or `[{` in such a
     reply is treated as JSON and hidden, even if the model meant it as prose. That trade only
     applies to the corrective plan turn; every other turn is untouched.
  - The three-word value from ADR-019 stands. "unreadable" now means "the object did not hold",
    not "the whole reply was an object".
- **Source:** `server/src/adapters/http/structured-plan.ts`,
  `packages/shared/src/todero-plan-schema.ts`, `ui/src/components/RunStructuredPlanNote.tsx`.

## ADR-021 — The window is settled by the capability endpoint, and the default is 16,384

- **Date:** 2026-09-15
- **Status:** Accepted (amends ADR-018, parts 3 and 4)
- **Context:** Three things measured on this machine after ADR-018 landed.

  1. ADR-018 part 3 re-checks a recorded window **once** and marks the organization with
     `toderoLocalLlmContextLengthRechecked`. It set that mark for *any* reading. With the model
     warm and `/api/ps` reporting Ollama's 4,096 default, a single failed `/api/show` recorded
     4,096 and closed the question: every later turn answered 4,096 and never asked again, and a
     fully healthy runtime afterwards did not repair it — only a person re-running a connection
     test could. Reproduced: turn one with one `/api/show` throw wrote
     `{contextLength: 4096, rechecked: true}`; turn two against a healthy runtime answering 32,768
     still returned 4,096 and did not call detection at all. This is ADR-018's own bug — a
     loaded-state snapshot treated as the answer — moved from the reading into the mark.
  2. ADR-018 part 4 raised the requested window to 32,768 on an argument about what the model can
     hold, with only a VRAM figure to price it. Timed properly on a 12 GB card with
     `qwen2.5-coder:14b`, two planning turns each against a padded thread: 4,096 → 21.1 tok/s,
     24.4 s a turn, nothing spilled; 16,384 → 21.3 tok/s, 25.7 s a turn, 2.2 GB spilled;
     32,768 → 16.0 tok/s, 33.5 s a turn, 5.3 GB spilled.
  3. ADR-016 put Todero's turn instruction inside the budget, which was right — outside it, the
     runtime trimmed the system prompt off the front. But nothing capped it: at a 1,024-token
     window a 300-word corrective instruction took the whole budget and all 40 turns of history
     were dropped. A model told to try again, with no memory of what it did the first time, is
     being set up to fail.
- **Decision:**
  1. Detection reports **which endpoint answered**. `detectContextLengthReading` returns
     `{ contextLength, capabilityAnswered }`, where `capabilityAnswered` is true only for
     `/api/show`. `detectContextLength` stays as the number-only form for the connection test,
     which stores upward and cannot lock anything.
  2. `resolveContextLengthForRun` sets the re-checked mark only when the capability endpoint
     answered. A run that heard only from `/api/ps` stores whatever that raised — upward only, as
     before — and asks again next turn, so a later healthy turn repairs a wrong stored value by
     itself. A reading that raises nothing and settles nothing is not written at all.
  3. `MAX_REQUESTED_CONTEXT_LENGTH` is **16,384**, from the measurement above: four times the
     broken default for no measurable cost, where the next step up costs about a quarter of the
     speed for room the prompt does not use. The number is this machine's, not a law — a 24 GB
     card would take 32,768 without spilling — which is why sizing the window to the machine is
     queued in `doc/plans/2026-09-14-any-llm-independence.md`.
  4. While there is a conversation to protect, the pinned turn instruction may take at most
     `TURN_INSTRUCTION_MAX_BUDGET_SHARE` (a quarter) of the prompt budget and is cut to fit, with
     a marker saying so. With no conversation in the prompt it is left exactly as it came.
- **Consequences:**
  - An organization can no longer be pinned to a load-time default by one failed request. The
     cost is that a runtime whose `/api/show` is permanently unreachable pays the detection pair
     every turn — it is the honest price of never locking in a wrong number.
  - Todero asks for 16,384 where ADR-018 asked for 32,768. A model that holds more is trimmed to
     16,384 and loses room, not capability; the `/api/show` capability is still recorded in full,
     so raising the ceiling later needs no re-detection.
  - At 16,384 the instruction cap is around 3,000 tokens and no instruction Todero writes comes
     near it, so it only ever bites on small windows — which is where it was needed.
- **Source:** `server/src/todero/available-models.ts`,
  `server/src/adapters/http/prompt-budget.ts`.

## ADR-022 — A blocked task says who it is waiting for, and a task stops asking for work it has

- **Date:** 2026-09-21
- **Status:** Accepted
- **Context:** Three waves of the improvement loop ended the same way.

  1. Two kinds of task sit at `blocked`: one waiting for the tasks before it to finish, and one
     Todero handed to a person (a question, a hand-in waiting to be read, a plan waiting for a
     yes, a task the manager is holding). The recovery backstop that brings back tasks whose
     earlier work is finished read only the row — id, company, identifier, assignee, blocked
     time — so the two looked identical and it woke the second kind too. Measured: 13 repeats on
     ZZGAAA-3 and 13 on ZZGAAA-5 in wave 16, 30 on ZZGAAA-5 in wave 17, 21 on ZZGAAAAA-3 in wave
     18. The guard against repeating a wake could not catch it: the key it compares includes the
     task's blocked time, and every hand-back stamps a new one, so every repeat looked like a
     first. The re-wake throttle could not catch it either — it only applies to wakes that assert
     state, and this one carries an event reason, and every woken turn left a comment behind,
     which the throttle counts as progress.
  2. A task handed the finished work of the tasks it waited on (ADR from
     `doc/plans/2026-09-20-dependency-handoff.md`) went on asking for it. Wave 16 and its
     recovery are the measured case: ZZGAAA-5 asked for the four drafts in 41 of its 42 turns,
     with the drafts in hand. Its own thread carried a dozen earlier turns saying "Could you
     please provide the four draft guides" and "I am still waiting for the four draft guides",
     and a 14B model reads its own last turns as the pattern to follow. Wave 18's 21 repeats on
     ZZGAAAAA-3 are a different fault that looks the same from a distance: that task repeated a
     clarifying question, not a request for missing work, and this decision does not address it.
  3. Wave 18's conversation task was read as a hand-back that asked nothing. It was not: it had
     proposed a plan, the approval cleared its notes and blocked it on its own children, and it
     was waiting on three tasks. The improvement-loop check treated any `blocked` row as a task
     in front of a person, which is the same confusion as (1), one layer up.
- **Decision:**
  1. Whether a task is waiting on a person is read from the task's own text, in one place:
     `isParkedOnPerson` (`server/src/todero/parked-on-person.ts`). It composes the predicates
     owned by the modules that write each note, so no note's shape is written twice. The
     backstop loads the task's text with its other columns and skips a task that is parked on a
     person, counted in its result like every other skip.
  2. When the work a task waited on is in hand, its own earlier turns asking for that work are
     left out of the thread it reads, and it is told in one sentence that the work is above and
     that this turn is for doing the task. What the person and the reviewer said is never
     dropped, and neither is a turn that hands work in — a task the reviewer sends back wakes
     with the earlier work in hand, and losing its own hand-in would make it write that work
     twice. The wrap-up and manager instructions still win. Both rules are pure and live in
     `server/src/todero/inputs-arrived.ts`; the heartbeat makes one call.
- **Consequences:**
  - A task Todero parks on a person is now woken only by an answer — a comment, an approval, a
     review. Nothing else brings it back, which is the point, and which means a park written
     without one of those notes is a park nothing will clear. Every path that parks a task must
     write its note.
  - The classifier that decides whether a turn is asking for something is deliberately narrow: a
     hand-in, a question about scope and a status report are never dropped. It will leave some
     stale sentences in a thread, and that is the cheaper mistake.
- **Source:** `server/src/todero/parked-on-person.ts`, `server/src/todero/inputs-arrived.ts`,
  `server/src/services/recovery/service.ts`,
  `docs/ai_context/gauntlet/repros/parked-task-stays-parked.gauntlet.ts`.

### Note, 2026-09-21 — the root task was never the problem, and the dead half of this is gone

A hard read of this branch, each point measured against the real module or the live API,
found that part of what ADR-022 describes was never wired up, and that one of the numbers
it leans on was the check's own arithmetic. Correcting it here rather than above, as this
log requires.

**The root task was never at fault.** Wave 18's conversation task was recorded as a
hand-back that asked nobody for anything. It was not one: the person had woken it, and the
reply it gave carried the plan. The count was the improvement-loop check's mistake — the
check read any blocked task with nothing unresolved as a task standing in front of a
person — and nothing in Todero needed changing for it. The helper written to recognise
"a reply that asks for nothing" was never called by anything; the check has always used a
rule of its own. That helper and its tests are deleted, along with the sentence in
`server/src/todero/inputs-arrived.ts` that claimed the check used it. The only change this
point calls for is in the check itself.

**What the check counts as standing in front of a person.** The check now reads the same
five notes the server reads, named in its Python with
`server/src/todero/parked-on-person.ts` given as the source of truth, and nothing else. A
blocked task with nothing unresolved and no note on it is no longer counted: that is a task
whose earlier work has just finished, which is the very task the wake backstop is there to
bring back. Measured over the three archived organizations: on `f818e743` the count of
hand-backs that asked nothing goes from 1 to 0, and the one row the old rule and the new
rule disagree on is the task whose last turn was a hand-in of four finished guides. On
`67d6f192` and `bddd6a6d` nothing moves — 0 before and 0 after, with the one real
hand-back that does ask still counted in each.

**The rule that leaves a task's own stale requests out of its thread is read a sentence at
a time.** It used to stop at the first claim of work done anywhere in the turn, which let
"I have drafted all four. Could you please provide the four draft guides?" stay in the
thread — the exact loop this closes, with a preamble in front of it. Now each sentence is
judged on its own: a sentence that asks for the work makes the turn a request whatever the
rest of it claims, a sentence that hands something over is not a request, and saying it
cannot go on counts only when nothing in the turn delivers. What is asked for, waited for
or needed also has to be the work itself, so a request to have something clarified, and
waiting for another person to send something, both stay. Re-measured over the 101 archived
agent turns: 41 of the 42 turns on `ZZGAAA-5` are still left out and the one that survives
is still the turn that assumed the drafts already existed; none of wave 18's 21 turns is
left out, unchanged.

### Note, 2026-09-21 — the ask really does win now, and two numbers above are corrected

The note before this one said that a sentence asking for the work makes the turn a request
whatever the rest of it claims. That was the intent, not the behaviour: the check for "this
sentence hands something over" ran before the checks for "this sentence asks", so a claim of
work done still won whenever the two shared one sentence. On a comma, a semicolon or the word
"so" the loop reopened — "I finished the outline, but I still need the four draft guides."
and "I have attached the outline; please provide the four draft guides." were both kept in
the thread. The asking checks now run first, and the sentence above is true as written. Six
such sentences are in the tests, watched failing before the change. Re-measured over the same
101 archived agent turns: nothing moved — 41 of the 42 turns on `ZZGAAA-5` are still left out,
and the survivor is still the turn that assumed the drafts already existed.

**What is not left out.** A bare "it" is not one of the names for the work, so "I am still
waiting for it." now stays in the thread where it used to come out. That is deliberate — a
task has to name the work to have its request dropped — and it costs nothing over the
archive, where no turn is worded that way.

**Two numbers above, corrected.** The twenty-one repeated turns the note before this one
credits to wave 18's organization `f818e743` are not there: they belong to `ZZGAAAAA-3` in
`67d6f192`. The count is right, the label was not, and it had been carried along from an
older comment. `f818e743` holds ten agent turns in total, none of them left out. The test
file for the wake backstop also says it has one case per way a task can be parked; it has
four of the five, with a plan waiting for a yes not among them, and now says so.

## ADR-023 — A task is judged on its own hand-in, and a turn that produced nothing is not parked

- **Date:** 2026-09-21
- **Status:** Accepted
- **Context:** Wave 19 of the improvement loop (organization
  `f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3`, "Zz Gauntlet Org 0921-034835"). Wave 3 stopped the
  backstop from re-waking parked tasks, so the organization stopped thrashing — and deadlocked
  instead. Two tasks ended up in front of a person without asking for anything; one of them gated
  five tasks that never ran. The project never finished. Both deadlocks have the same two steps.

  1. **A send-back nobody could satisfy.** ZZGAAAAAAAAA-4 "Draft the second guide" handed in a
     correct second guide — Pothos, the light it needs, how often to water it — and the reviewer
     sent it back: "not met — Four drafts, each naming the plant, the light it needs, and how
     often to water it ... it only contains information for one plant. To pass, it must include
     information for three additional houseplants." "Four drafts" is the feature's finish line,
     not the task's. The reviewer's list of things to check was built from the feature's done-when
     line plus the task's hand-in line, for every task inside the feature, so a task asked for one
     guide was being held to a four-guide bar it could never reach. ZZGAAAAAAAAA-11 "Finalize the
     first guide" was sent back the same way.
  2. **A retry that delivered nothing and asked nothing.** On the round that came back, with the
     reviewer's note in its prompt, ZZGAAAAAAAAA-4 wrote its own task brief out again — goal,
     feature, done when, what the person said, the last verdict — with no guide in it.
     ZZGAAAAAAAAA-11 wrote a "Final Review and Next Steps" action list about work it had not done.
     Neither reply carried a `STATUS: done` line, and a chat reply without one means "waiting";
     waiting means the person's turn, so both tasks were parked, the run log said "Handed the turn
     back to the user", and the person — correctly — never answered a turn that asked nothing.
- **Decision:** two mechanisms. The first is the cause; the second is the safety net.

  1. **A task is judged on its own hand-in line.** The feature's done-when line is something the
     reviewer must check only on the task the feature ends with — the last task in the plan
     carrying that feature's name, which for a one-task feature is that task. On every earlier
     task the line is still given to the reviewer, in plain words, as background: "This task is
     one step of <feature>, which is finished when: <line>. That is the finish line for the whole
     of <feature>, not for this task — judge only this task's hand-in." A task that wrote its own
     Acceptance Criteria section is unaffected, as before. Leaving the flag out keeps today's
     behaviour, so a caller that cannot tell where the task sits loses nothing.
  2. **A turn that handed nothing in and asked nothing is not parked.** When a task inside a plan
     hands its turn back, and its reply asks the person for nothing and hands nothing in, Todero
     does not put it in front of the person the first time. It says so on the task in plain words,
     and wakes the worker with one instruction: write the work itself — the guide, the list, the
     document — not a summary of the task and not a list of next steps, and end with
     `STATUS: done`. If the second turn is no better the task does go to the person, with a
     message saying it produced no work twice. There is never a third silent round. The
     conversation task is untouched: its "waiting" is the person's turn by design.

  "Asks the person for anything" is wider than the wave-3 rule it sits beside: a question mark, a
  request put to the person, or saying it cannot go on. "We need to finalize the remaining three
  guides" is the task talking about its own work and does not count — it is the exact sentence the
  deadlocked task wrote. "Handed nothing in" is decided by taking the task read back and the list
  of what to do next out of the reply and seeing whether anything of substance is left. A real
  guide with "Next steps" tacked on the end is a hand-in like any other.
- **Consequences:**
  - A reviewer can now pass a task that did exactly what it was asked, mid-feature. The feature's
    finish line is still enforced, once, on the task the feature ends with.
  - A worker gets one extra turn before its task reaches a person, and the person sees a note
    saying nothing is needed from them. The cost is one local turn; the alternative was a deadlock.
  - The count of empty turns is kept in the task's text (`todero-empty-turns`), beside the plan
    tries and the reviewer's rounds, and goes back to nothing when the task hands real work in —
    so "twice" means twice in a row. It is cleared twice over, because two different writes can
    put it back: once where the hand-in is saved (`heartbeat.ts`), and again inside
    `applyJudgeReview`, which writes the task's text out from a copy taken before that save.
    Anything that reaches the reviewer is real work by definition, so clearing it there is right
    as well as safe, and it is the clearing a test can hold.
  - The retry leaves the task at `todo` and wakes it, rather than at `in_progress`. A task left
    running with no turn behind it is read by the recovery sweep as a turn that stopped halfway,
    which would start a second turn of its own. This is the same route the plan rescue already
    takes, and the point holds either way: the task is not in front of the person.
  - Both mechanisms live in their own modules (`server/src/todero/judge.ts`,
    `server/src/todero/empty-turn-recovery.ts`). The heartbeat's two rescues now share one set of
    dependencies and one wake, so the file did not grow.
  - Repros: `docs/ai_context/gauntlet/repros/task-judged-on-its-own-hand-in.gauntlet.ts` and
    `docs/ai_context/gauntlet/repros/empty-retry-is-not-parked.gauntlet.ts`, both built from the
    real plan and the real replies of `f6e02c4b`, and both registered in `checks.json`.

### Correction, 2026-09-21, after review

The first build of this ADR's second mechanism had the reset in one place only, and a review of
the branch found that a send-back undid it. The sequence was: a turn that produced nothing (count
one), a turn that handed a real guide in (count cleared), the reviewer sending that guide back —
which wrote the task's text back out from the copy taken before the hand-in was saved, count one
again — and then a turn that produced nothing. Todero read the count as two in a row, skipped the
one corrective turn this ADR promises, parked the task, and told the person it had "produced no
work twice", which was not true. That is the send-back-then-empty-turn shape of wave 19 with the
safety net switched off, so the whole ADR rested on it. `applyJudgeReview` now clears the count on
the text it writes, which no caller can undo, and `judge-apply.test.ts` walks the four-step
sequence above and fails if the clearing is taken out.

Two other things the review found were wiring that nothing tested, and both now have a test that
fails when the wiring is broken. The rule about which task a feature ends with is applied on one
line inside `reviewConversationHandIn`; `judge-review-task-position.test.ts` drives that function
for real and reads the prompt the model was sent, so replacing that line with either constant
fails. And the guard that keeps a question in front of the person was only ever exercised by
questions long enough to read as a hand-in in their own right; both the test and the repro now use
a short one ("Which four plants?"), where nothing but the question mark keeps the task off the
retry.

The repro `task-judged-on-its-own-hand-in.gauntlet.ts` said its plan was copied from the
organization's Plan document and carried eight of its thirteen tasks, which changed where two
features ended. It now carries the document whole, and counts the tasks in its first case so a
shortened copy fails rather than quietly moving a feature's finish line.

### Second correction, 2026-09-21, after the wave-20 review

The consequence bullet above says the count of empty turns is "cleared twice over" and the
correction before this one says the reviewer's clearing is one "no caller can undo". Neither holds,
because both describe only the writes that go through the reviewer's own code. When a reviewer
passes a hand-in and the organization closes on a pass, nothing writes the task's text there at
all: the closing text is built from the copy the hand-in was planned with, taken before the
hand-in write cleared the count, so a task closed that way kept a count from a turn that had
already been made good. A person's comment on a closed task sets it going again with exactly that
text, and the next turn that produced nothing then read the count as its second — no corrective
turn, and a message telling the person the task had produced no work twice when it had done so
once, weeks earlier.

The count is now cleared in three places, and the third is the last word: where the hand-in is
saved (`heartbeat.ts`), on every text `applyJudgeReview` writes, and in
`descriptionWithoutConversationMarkers`, which is what a closing task keeps. The count belongs
with the three markers that helper already takes off — it is one more thing the conversation wrote
on the task — so it now lives beside them in `conversation-outcome.ts` and
`empty-turn-recovery.ts` passes it on under its own name. Two tests hold it: the text a reviewer's
accept closes with carries no count, and the four steps above (a turn that produced nothing, a
real hand-in, a pass that closes the task, a comment that sets it going again, a turn that
produced nothing) end in the corrective turn rather than in front of the person.

Three smaller things in the same review:

- **A terse hand-in read as nothing.** The rule for "handed nothing in" struck out any line
  beginning `Output:`, `Progress:` or `Status:`, so a worker that wrote the whole of a short
  hand-in under one of those labels was asked for it again. Those labels are now taken off and
  what follows them is kept, and the bar for "something of substance" is twenty characters rather
  than forty — a plant, the light it needs and how often to water it is the whole of what one of
  these tasks was asked for, and it fits in thirty-three. The labels of the task read back (goal,
  feature, done when, what the person said, last verdict) are still struck out with their lines,
  so the wave-19 reply that started all this still counts as nothing handed in.
- **A test that restated a constant.** The corrective turn's wake reason was proved only by a test
  asserting the constant equalled its own string. The heartbeat's mapping from that wake reason to
  the instruction is now one pure function, `emptyTurnInstructionForWake`, called from the
  heartbeat on the line the comparison used to sit on, and the test drives that function: its own
  reason gives the instruction, any other reason and no reason give nothing.
- **The harness answered twice in a hundred milliseconds.** `checks/live-loop.py` answered a
  task's question and re-read the task in the same breath. The comment is what wakes the worker,
  so the question was still standing, and the check spent both of the answers it allows 107 ms
  apart and failed the task with "still asking after two answers" before the worker had reacted to
  either — a false regression headline in wave 20's report. It now waits, up to two minutes, until
  the question is off the task or the task changes state, and says in its log line when that wait
  ran out. In the run it failed on (`Zz Gauntlet 0921-091116`, ZZGAAAAAAAAAA-5) the worker's reply
  to the first answer arrived 24.2 seconds after it was posted, so one answer would have been
  enough.

`gauntlet/reports/last-org.json` still names wave 20's organization
(`42c3d5e4-f0fd-4aea-ae98-32e90707d31f`), which stopped with its last task refused twice by the
reviewer for not being "formatted and ready for distribution" — a packaging line a text hand-in
cannot prove. That is deliberate: it is the case the next wave starts from. Wave 19's organization
(`f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3`) remains the case for a task parked before all of this
that has no way back, which nothing here fixes.

## ADR-024 — The last task of a feature is judged with what the feature already achieved, and a parked task gets its way back

- **Date:** 2026-09-21
- **Status:** Accepted
- **Context:** Wave 20 of the improvement loop, and two failures that between them stop a project
  dead at the last step and leave no way back to it.

  1. **The last task of a project was refused for what earlier tasks had already done.**
     Organization `42c3d5e4-f0fd-4aea-ae98-32e90707d31f` ("Zz Gauntlet Org 0921-092802"). The
     feature "Review and Editing" finishes when "All four guides have been reviewed and edited,
     with final drafts ready for publishing". Its first task, ZZGAAAAAAAAAAA-4 "Review and edit
     the draft guides", handed in four edited guides, was accepted and closed. Its last task,
     ZZGAAAAAAAAAAA-5 "Prepare the guides for publishing", handed in those same four guides twice
     and was refused both times — "not met — All four guides have been reviewed and edited ... The
     guides are in plain text format and have not been reviewed or edited", then "I reviewed this
     twice and it is still not there. Over to you." The project stopped there.

     Two things were wrong with what the reviewer was given. It was never told that
     ZZGAAAAAAAAAAA-4 exists, was accepted, or what it handed in — the reviewer sees one hand-in
     and the whole feature's finish line, and judged work its own teammate had already finished as
     not done. And "formatted and ready for distribution" is about how text would be laid out on a
     page, which a chat reply cannot show at all, so a 14B reviewer reads plain prose and answers
     "not formatted" every single time.

  2. **A task parked before a fix had no way back.** Wave 20 reopened wave 19's organization
     (`f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3`) to watch the corrective turn from ADR-023 work. It
     never fired. That turn happens at the moment a turn ends badly, and those two tasks had been
     parked before it existed, so their bad turns were long over. Nothing wakes a parked task. Two
     tasks sat in front of a person with a reply that asked them nothing, five tasks queued behind
     them, and not one turn ran in fifteen minutes. Every person who updates Todero while a
     project is running is in that same position.
- **Decision:**

  1. **The reviewer is told what the rest of the feature already finished.** When the task under
     review has predecessors in the same feature that are done and handed something in, the brief
     names each one, shows what it handed in, and says in plain words that the work is finished
     and counts as done — so anything the feature's finish line asks for that one of them already
     did is met unless this hand-in undoes it. The predecessors are the ones the hand-off already
     looks up (`task-inputs.ts`); nothing here writes a second lookup, it only adds each one's
     status. The feature's finish line is still a check on the task the feature ends with, and the
     verdict comment now names who made it true: "met — done on ZZGAAAAAAAAAAA-4 and accepted".

  2. **A packaging line is judged on substance.** A short written-out list of phrases — formatted,
     laid out, typeset, exported, print-ready, ready for distribution / publishing / release — is
     recognised in the task's own hand-in line and in whatever it has to be true for. When one is
     there the brief says that a plain-text hand-in cannot show how anything is laid out, and that
     such a line is met when the content itself is complete and reads well. The list is written
     out on purpose: working out what a sentence really asks for is the reviewer's job, and this
     only has to spot the handful of phrases no chat reply can ever satisfy.

  3. **Starting an organization again offers a parked task its corrective turn.** The door that
     already runs the reviews a hold deferred now does a second thing after them: it finds the
     tasks this organization has parked in front of the person whose last turn neither asked for
     anything nor handed anything in and which no person has answered since, and gives each one
     the same corrective turn the end of a bad turn gives — off the person's desk, counted as the
     one try, the worker asked once more for the work itself. A task Todero has already asked once
     is left parked; that one really is the person's. Same guards as the reviews: one pass per
     organization at a time, the organization's state re-read before every task, one failure never
     costing the next task its turn, and nobody waiting on it over HTTP.
- **Where:** `server/src/todero/judge-feature-work.ts` (new — the packaging list, the block of
  accepted work, which checks an earlier task settled), `judge.ts` (`acceptedWorkOfSameFeature`,
  and the brief and the comment), `judge-review.ts` (`loadAcceptedFeatureWork`, built on
  `collectTaskInputs`), `empty-turn-recovery.ts` (`buildEmptyTurnRetry`, lifted out so both doors
  build the same turn rather than copying it), `parked-turn-recovery.ts` (new — the rule, the
  database reads, the pass), `deferred-review.ts` (the two passes composed at the one resume door).
- **Consequences:** The reviewer's brief grows by what one earlier task handed in, capped at 1,500
  characters and cut with the same words the worker's own block uses. A task with no accepted work
  of its own feature and no packaging line gets the brief it got before, word for word, which a
  test holds. Todero can now start a task that a person was looking at, once — that is the point,
  and it is said on the task in plain words before it happens. Repros:
  `gauntlet/repros/last-task-judged-with-its-feature.gauntlet.ts` (built from 42c3d5e4's real plan
  and ZZGAAAAAAAAAAA-4's real hand-in) and `gauntlet/repros/parked-task-gets-its-way-back.gauntlet.ts`
  (wave 19's real replies), both registered in `gauntlet/checks.json`.
