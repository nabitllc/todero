# Data Model

Deep reference is `doc/DATABASE.md`; the change workflow is `AGENTS.md` § 6. This file records the
invariants and the facts a session most often gets wrong.

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

These are control-plane invariants, listed in `AGENTS.md` § 5.3 and enforced in schema and services.
Preserve them; a change that breaks one is a product change, not a refactor.

**1. Everything is company-scoped.** Every domain entity carries a company id and boundaries are
enforced in routes and services (`AGENTS.md` § 5.1). In `packages/db/src/schema/issues.ts`:

```ts
companyId: uuid("company_id").notNull().references(() => companies.id),
```

`notNull` on the reference is the schema-level half of the invariant. The route-level half is the
access check — see `server/src/services/access.ts` and `server/src/services/authorization.ts`.
Agent API keys must never reach another company (`AGENTS.md` § 8); keys live in `agent_api_keys` and
are hashed at rest.

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
(`AGENTS.md` § 8).

**7. Human-facing issue identifiers are company-local.** `companies.issuePrefix` (default `"PAP"`)
and `companies.issueCounter` produce `issues.issueNumber` / `issues.identifier`. These are
instance-local — `CONTRIBUTING.md` § No Internal Issue References forbids putting them in a public
PR, branch, commit or comment.

## Changing the schema

From `AGENTS.md` § 6:

1. Edit `packages/db/src/schema/*.ts`.
2. Export any new table from `packages/db/src/schema/index.ts`.
3. `pnpm db:generate` — this compiles `packages/db` first, because `drizzle.config.ts` reads the
   **compiled** schema from `dist/schema/*.js`, not the sources.
4. `pnpm -r typecheck`.

Then sync the contracts across all four layers — `packages/db`, `packages/shared`, `server`, `ui`
(`AGENTS.md` § 5.2). A schema change that stops at the database is incomplete.

Two guards run inside `@todero/db`'s `build`, `typecheck` and `generate` scripts:
`src/check-migration-numbering.ts` and `src/check-migration-safety.ts`. CI additionally validates
migration ordering against the target branch (`.github/workflows/pr-trusted.yml:295`).

Applying migrations: `pnpm db:migrate` (`packages/db/src/migrate.ts`). With `DATABASE_URL` unset it
targets the embedded instance for the active Todero config.

## The three data paths — do not merge them

`AGENTS.md` § 5.7 is required reading before touching anything that emits data. Match by file path,
never by the words "observability" or "telemetry":

- **Telemetry** — first-party, opt-out, ships to a Todero endpoint by default. Strict review plus a
  privacy review. `packages/shared/src/telemetry/`.
- **Observability** — OpenTelemetry traces, no-op until an operator sets an OTLP endpoint. Lighter
  review. `server/src/instrumentation.ts`, `doc/observability.md`.
- **Run log** — rows in `heartbeat_run_events`, never leaves the instance database. No extra review.
  `packages/db/src/schema/heartbeat_run_events.ts`, appended by `appendRunEvent` in
  `server/src/services/heartbeat.ts`, documented in `doc/run-log-events.md`.
