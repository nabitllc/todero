-- sqlite mirror of migrations/075_token_ledger_status_vocabulary.sql — see that
-- file for WHY. This file is only about HOW.
--
-- SQLite has no ALTER TABLE ... DROP CONSTRAINT, so a CHECK can only be changed
-- by rebuilding the table (the documented 12-step procedure). The column list
-- below is 000_baseline.sql's token_ledger plus the four columns
-- 054_ledger_upstream_correlation.sql adds, and the four indexes are recreated
-- exactly as 000_baseline.sql and 054 declare them.
--
-- `JSON_TEXT` on `metadata` is not a typo and not a real SQLite type: it is the
-- declared-type marker lib/db/sqlite-adapter.ts reads back out of
-- `PRAGMA table_info` to decide that this column must be JSON-decoded on read.
-- Dropping it here would silently turn every metadata object in the app into a
-- string, so it is reproduced verbatim.
--
-- Rows are copied by explicit column name, so a database whose physical column
-- order differs from this file's still lands correctly.
--
-- `token_ledger_orphans` (migrations/sqlite/038_agent_budgets_and_ceilings.sql)
-- is a view over this table, and SQLite refuses to DROP a table a view still
-- names — this migration failed on exactly that the first time it was run
-- against a scratch database. It is dropped and recreated verbatim below.

DROP VIEW IF EXISTS token_ledger_orphans;

CREATE TABLE token_ledger_new (
  id            TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id      TEXT      NOT NULL,
  task_id       TEXT,
  task_key      TEXT,
  runtime       TEXT      NOT NULL,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  total_tokens  INTEGER,
  cost_usd      REAL,
  prompt_bytes  INTEGER,
  log_file      TEXT,
  spawned_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  status        TEXT      NOT NULL DEFAULT 'spawned',
  metadata      JSON_TEXT,
  provider_response_id TEXT,
  provider_model       TEXT,
  upstream_started_at  TEXT,
  upstream_finished_at TEXT,
  CHECK ((status IN ('spawned', 'completed', 'failed', 'killed', 'max_iterations', 'running', 'unknown')))
);

INSERT INTO token_ledger_new (
  id, agent_id, task_id, task_key, runtime, model, input_tokens, output_tokens,
  total_tokens, cost_usd, prompt_bytes, log_file, spawned_at, completed_at,
  status, metadata, provider_response_id, provider_model, upstream_started_at,
  upstream_finished_at
)
SELECT
  id, agent_id, task_id, task_key, runtime, model, input_tokens, output_tokens,
  total_tokens, cost_usd, prompt_bytes, log_file, spawned_at, completed_at,
  status, metadata, provider_response_id, provider_model, upstream_started_at,
  upstream_finished_at
FROM token_ledger;

DROP TABLE token_ledger;

ALTER TABLE token_ledger_new RENAME TO token_ledger;

CREATE INDEX IF NOT EXISTS token_ledger_agent_spawned_idx ON token_ledger (agent_id, spawned_at DESC);
CREATE INDEX IF NOT EXISTS token_ledger_runtime_idx ON token_ledger (runtime, spawned_at DESC);
CREATE INDEX IF NOT EXISTS token_ledger_task_idx ON token_ledger (task_key);
CREATE INDEX IF NOT EXISTS token_ledger_provider_response_idx ON token_ledger (provider_response_id);

-- Recreated verbatim from migrations/sqlite/038_agent_budgets_and_ceilings.sql.
-- If that definition ever changes, this copy must change with it.
CREATE VIEW IF NOT EXISTS token_ledger_orphans AS
SELECT *
FROM token_ledger
WHERE status = 'spawned'
  AND spawned_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour');
