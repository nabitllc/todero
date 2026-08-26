-- 066 (sqlite): restore the four bug-report columns the baseline dropped.
--
-- This is the SQLite dialect of migrations/066_bug_report_columns.sql. Read that
-- file for the reasoning: which deadlock this fixes, why these four columns are
-- ADDED while `test_status` is deliberately NOT, and the measurements behind
-- both halves of that decision.
--
-- Dialect note, same one migrations/sqlite/057 records: SQLite has no
-- `ADD COLUMN IF NOT EXISTS` and rejects it at 'near "EXISTS"'. The runner's
-- schema_migrations ledger is what makes a bare ADD COLUMN run exactly once, so
-- the guard the Postgres file gets from IF NOT EXISTS is not needed here.

ALTER TABLE issues ADD COLUMN steps_to_reproduce TEXT;
ALTER TABLE issues ADD COLUMN expected_behavior  TEXT;
ALTER TABLE issues ADD COLUMN actual_behavior    TEXT;
ALTER TABLE issues ADD COLUMN environment        TEXT;
