# Data Model

Deep reference is `doc/DATABASE.md`. This file records the invariants, the schema change workflow,
and the facts a session most often gets wrong.

## What the database actually is

**PostgreSQL, via Drizzle ORM.** Verified 2026-09-06:

- `packages/db/drizzle.config.ts` — `dialect: "postgresql"`, schema read from `./dist/schema/*.js`,
  migrations written to `./src/migrations`.
- `packages/db/package.json` — `drizzle-orm ^0.45.2`, `drizzle-kit ^0.31.10`, `postgres ^3.4.9`,
  `embedded-postgres ^18.1.0-beta.16` (a bundled dependency).
- `doc/DATABASE.md` line 3: Todero uses PostgreSQL via Drizzle ORM.

Three corrections to assumptions that are easy to import from elsewhere in the portfolio:

- **There is no Prisma.** Grepped `packages/`, `server/`, `ui/`, `cli/` — zero matches in any
  `package.json` or `.ts` file. `pnpm db:generate` is drizzle-kit, not `prisma generate`.
- **There is no Supabase client.** Zero matches in any workspace `package.json`. Supabase appears in
  `doc/DATABASE.md` § 3 only as one suggested *hosted PostgreSQL provider* for production; nothing
  in the code depends on it.
- **The app database is not SQLite.** In dev with `DATABASE_URL` unset the server starts embedded
  PostgreSQL and stores it under `~/.todero/instances/default/db/` (`doc/DATABASE.md` § 1). That
  path is a Postgres data directory. Deleting it resets local dev.

The one real SQLite in the tree is unrelated to the app database: `server/src/todero/vault-settings.ts`
opens `vault-settings.sqlite` through Node's built-in `node:sqlite` `DatabaseSync` for local vault
settings only.

## Shape

`packages/db/src/schema/` holds **122** table modules, one table per file, each re-exported from
`packages/db/src/schema/index.ts`. `packages/db/src/migrations/` holds **232** generated `.sql`
migrations.

## Invariants

These are the control-plane invariants, enforced in schema and services. Preserve them; a change
that breaks one is a product change, not a refactor. Invariants 1 to 6 moved here from
`AGENTS.md` § 5.1 and § 5.3 on 2026-09-06 (ADR-010).

**1. Everything is company-scoped.** Every domain entity carries a company id and boundaries are
enforced in routes and services. In `packages/db/src/schema/issues.ts`:

```ts
companyId: uuid("company_id").notNull().references(() => companies.id),
```

`notNull` on the reference is the schema-level half of the invariant. The route-level half is the
access check — see `server/src/services/access.ts` and `server/src/services/authorization.ts`.
Agent API keys must never reach another company (`decisions.md` ADR-003); keys live in
`agent_api_keys` and are hashed at rest.

**2. Single-assignee task model.** `issues` carries `assigneeAgentId` (FK to `agents`) and
`assigneeUserId` — one assignee, not a join table.

**3. Atomic issue checkout.** `issues.checkoutRunId` and `issues.executionRunId` reference
`heartbeat_runs` (`onDelete: "set null"`), with `executionLockedAt` and `executionAgentNameKey`
alongside. `statusVersion` is a `bigint` defaulting to 0 and `lastStatusDecisionId` records the
deciding row — the optimistic-concurrency pair that makes checkout atomic and prevents double-work.
Authorization compares `runIssue.checkoutRunId === input.actor.runId`
(`server/src/services/authorization.ts:828`).

**4. Approval gates for governed actions.** `approvals`, `approval_comments`, `issue_approvals`;
`companies.requireBoardApprovalForNewAgents` is the company-level switch.

**5. Budget hard-stop auto-pause.** `companies.budgetMonthlyCents` and `spentMonthlyCents` (integer
cents, both `notNull` default 0), plus `budget_policies`, `budget_incidents` and `cost_events`.
Enforcement lives in `server/src/services/budgets.ts`. Company pause state is on `companies` itself:
`status`, `pauseReason`, `pausedAt`.

**6. Activity logging for mutating actions.** `activity_log`, written via
`server/src/services/activity-log.ts`. New mutating endpoints write an entry
(`decisions.md` ADR-003).

**7. Human-facing issue identifiers are company-local.** `companies.issuePrefix` (default `"PAP"`)
and `companies.issueCounter` produce `issues.issueNumber` / `issues.identifier`. These are
instance-local — `CONTRIBUTING.md` § No Internal Issue References forbids putting them in a public
PR, branch, commit or comment.

## Changing the schema

Moved here from `AGENTS.md` § 6 on 2026-09-06 (ADR-010).

1. Edit `packages/db/src/schema/*.ts`.
2. Export any new table from `packages/db/src/schema/index.ts`.
3. `pnpm db:generate` — this compiles `packages/db` first, because `drizzle.config.ts` reads the
   **compiled** schema from `dist/schema/*.js`, not the sources.
4. `pnpm -r typecheck`.

Then sync the contracts across all four layers — `packages/db`, `packages/shared`, `server`, `ui`
(`architecture.md` § Contract synchronization). A schema change that stops at the database is
incomplete.

Two guards run inside `@todero/db`'s `build`, `typecheck` and `generate` scripts:
`src/check-migration-numbering.ts` and `src/check-migration-safety.ts`. CI additionally validates
migration ordering against the target branch (`.github/workflows/pr-trusted.yml:295`).

Applying migrations: `pnpm db:migrate` (`packages/db/src/migrate.ts`). With `DATABASE_URL` unset it
targets the embedded instance for the active Todero config.

## The three data paths — do not merge them

Read this section before you touch anything that emits data. Moved here from `AGENTS.md` § 5.7 on
2026-09-06 (ADR-010); `CONTRIBUTING.md` § Telemetry Changes points at it.

This repo has three separate data paths. Do not confuse them. Match a change to a path by its file
path, not by the word "observability" or "telemetry" alone.

- **Telemetry** is the Todero first-party event system. It is opt-out and it sends data to a Todero
  endpoint by default. Its paths are:
  - `packages/shared/src/telemetry/`
  - the generated contract `packages/shared/src/telemetry/generated/paperclip-telemetry.ts`
  - each caller of `packages/shared/src/telemetry/events.ts` or
    `packages/shared/src/telemetry/client.ts`
- **Observability** is the OpenTelemetry trace path. An operator must set an OTLP endpoint. Until an
  operator sets the endpoint, the tracer is a no-operation. Its paths are:
  - `server/src/instrumentation.ts`
  - `doc/observability.md`
  - `packages/adapter-utils/src/duplex-observability.ts`
  - `server/src/services/duplex-observability-recorder.ts`
  - the span attributes in `packages/adapter-utils/src/acpx-engine/startup-timing.ts`
- **The run log** holds rows in the local `heartbeat_run_events` table. The data stays in the
  instance database. Its paths are:
  - `doc/run-log-events.md`
  - `packages/db/src/schema/heartbeat_run_events.ts`
  - the append path `appendRunEvent` in `server/src/services/heartbeat.ts`

Apply a review level that matches the path:

- **Telemetry change (strict review).** The author updates the generated contract first. The author
  updates `packages/shared/src/telemetry/README.md` in the same pull request. The author requests a
  privacy review. Reason: a Telemetry event goes to a Todero endpoint by default, so a mistake sends
  data immediately.
- **Observability change (lighter review).** The operator endpoint gate stays in place. The
  no-operation behaviour stays when no endpoint is set. A privacy review is not necessary while the
  change stays inside the closed span-attribute allowlist.
- **Run-log change (no extra review).** A run-log change needs neither review level above, because
  the data stays in the instance database.

**Exclusion.** The word "observability" in a file such as
`server/src/services/recovery-observability.ts` names a different concept. Apply this rule by path,
not by word match.
