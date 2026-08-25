-- sqlite mirror of migrations/038_agent_run_records.sql — see that file for
-- why this table exists. Same uuid-generation idiom as every other table in
-- 000_baseline.sql; booleans as INTEGER 0/1 (sqlite has no boolean type);
-- timestamptz as TEXT ISO-8601, same as every other table here.

CREATE TABLE IF NOT EXISTS agent_run_records (
  id                TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id          TEXT      NOT NULL,
  task_key          TEXT      NOT NULL,
  task_title        TEXT,
  status            TEXT,
  attempted         TEXT,
  succeeded         INTEGER   NOT NULL DEFAULT 0,
  failed            INTEGER   NOT NULL DEFAULT 0,
  rejection_count   INTEGER   NOT NULL DEFAULT 0,
  rejection_reason  TEXT,
  reviewer_notes    TEXT,
  exit_status       INTEGER,
  created_at        TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS agent_run_records_agent_created_idx
  ON agent_run_records (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_run_records_task_key_idx
  ON agent_run_records (task_key);
