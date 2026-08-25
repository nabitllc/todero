-- SQLite dialect of migrations/038_agent_budgets_and_ceilings.sql — see that
-- file for why this schema exists (TOD-2381, agent-budget-stop) and what each
-- column is for. Applied incrementally on top of 000_baseline.sql, same as
-- every other numbered file in this directory: scripts/db-migrate.mjs, and
-- (round 3) lib/db/boot-migrate.ts's synchronous sqlite path, both apply
-- migrations/sqlite/*.sql in filename order, tracked in schema_migrations —
-- which is exactly what makes the sqlite provider able to self-heal this
-- schema at boot with zero credentials, the thing the postgres-only version
-- of this file could not do for a supabase-provider install with no
-- DATABASE_URL (see lib/db/boot-migrate.ts's comment on ensureMigratedOnBoot).
--
-- Dialect notes: NUMERIC(10,2)/BIGINT -> REAL/INTEGER (sqlite is dynamically
-- typed; better-sqlite3 round-trips both fine). timestamptz -> TEXT holding an
-- ISO-8601 UTC string, matching every other migration in this directory.
--
-- No CHECK-constraint rewrite is needed here the way the Postgres file needed
-- one: this directory's own agent_runs (000_baseline.sql) has never
-- constrained `status` at all, so 'stopped' is already a legal value with
-- nothing to alter.
--
-- No `IF NOT EXISTS` on the ADD COLUMN statements below — unlike Postgres,
-- SQLite's ALTER TABLE grammar has never supported that clause on ADD COLUMN
-- (confirmed against the SQLite 3.53 this checkout's better-sqlite3 bundles:
-- `near "EXISTS": syntax error`). Plain ADD COLUMN is safe here because
-- lib/db/boot-migrate.ts and scripts/db-migrate.mjs both gate every file in
-- this directory behind `schema_migrations` — this file runs at most once
-- ever per database, so there is nothing to be idempotent against.

CREATE TABLE IF NOT EXISTS agent_budgets (
  agent_id                TEXT PRIMARY KEY,
  period                  TEXT NOT NULL DEFAULT 'daily'
                                CHECK (period IN ('run', 'daily', 'monthly')),
  limit_usd                REAL,
  max_concurrent_runs      INTEGER NOT NULL DEFAULT 1,
  max_run_ms                INTEGER NOT NULL DEFAULT 3600000,
  no_progress_heartbeats    INTEGER NOT NULL DEFAULT 3,
  max_runs_per_period       INTEGER NOT NULL DEFAULT 20,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE agent_runs ADD COLUMN pid                INTEGER;
ALTER TABLE agent_runs ADD COLUMN stall_count         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN last_progress_hash  TEXT;
ALTER TABLE agent_runs ADD COLUMN last_progress_at    TEXT;
ALTER TABLE agent_runs ADD COLUMN stopped_reason       TEXT;
ALTER TABLE agent_runs ADD COLUMN stopped_at           TEXT;

CREATE INDEX IF NOT EXISTS agent_runs_status_agent_idx ON agent_runs (status, agent_id);

-- token_ledger_orphans view — same definition as the Postgres file, minus the
-- NOW()/INTERVAL Postgres syntax.
CREATE VIEW IF NOT EXISTS token_ledger_orphans AS
SELECT *
FROM token_ledger
WHERE status = 'spawned'
  AND spawned_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour');
