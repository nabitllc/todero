-- sqlite form of migrations/060_run_steps.sql — see that file for what a row
-- means and, in particular, for why `tokens`, `duration_ms` and `cost_usd` are
-- nullable rather than defaulted to 0.
--
-- Same dialect conversions every other twin in this directory makes: the uuid
-- idiom from 000_baseline.sql, timestamptz as ISO-8601 TEXT, boolean as
-- INTEGER 0/1, numeric as REAL.

CREATE TABLE IF NOT EXISTS run_steps (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  run_id      TEXT    NOT NULL,
  step_no     INTEGER NOT NULL,
  tool        TEXT    NOT NULL,
  what        TEXT    NOT NULL,
  detail      TEXT,
  tokens      INTEGER,
  duration_ms INTEGER,
  ok          INTEGER NOT NULL DEFAULT 1,
  cost_usd    REAL,
  provider    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (run_id, step_no)
);

CREATE INDEX IF NOT EXISTS run_steps_run_id_step_no_idx ON run_steps (run_id, step_no);
