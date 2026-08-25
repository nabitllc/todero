-- memory-loop-retrieval piece: FTS5 index over agent_run_records.
--
-- TOD-489 (memory-loop.ts / migrations/sqlite/040_agent_run_records.sql)
-- built the WRITE side of the learning loop: one structured row per agent
-- run, capturing what was attempted and why it was rejected. Nothing ever
-- searched it. spawn-context.sh instead injected self-improving/corrections.md
-- WHOLESALE — every correction ever written, uncapped, unranked, oldest
-- crowding out newest exactly like the self_improving HOT-tier bug
-- memory-loop.ts's round-3 comment describes for the sibling table.
--
-- This migration gives the run-record store a real search index so a Builder
-- starting a task can ask "have I gotten this wrong before?" and get back the
-- three times that mattered, ranked by relevance, instead of paying context
-- budget for every correction on every task regardless of relevance.
--
-- FTS5 ships built into the sqlite3 amalgamation better-sqlite3 vendors, so
-- this needs no extension load step. `content=` + `content_rowid=` makes this
-- an EXTERNAL-CONTENT table: the FTS index stores only the inverted index,
-- not a second copy of the text, and reads through to agent_run_records for
-- the actual column values. `rowid` is SQLite's always-present implicit
-- rowid (agent_run_records has no `WITHOUT ROWID` clause and no INTEGER
-- PRIMARY KEY alias, so this is a distinct, stable integer per row) — not the
-- TEXT `id` column, which FTS5's content_rowid cannot use directly.
CREATE VIRTUAL TABLE IF NOT EXISTS agent_run_records_fts USING fts5(
  task_key,
  task_title,
  attempted,
  rejection_reason,
  reviewer_notes,
  content='agent_run_records',
  content_rowid='rowid'
);

-- Backfill: index every row that existed before this migration ran. Safe to
-- run exactly once — `boot-migrate.ts` / `db-migrate.mjs` both track applied
-- filenames in `schema_migrations` and never re-run a file, so this INSERT
-- cannot double-index a row on a later boot.
INSERT INTO agent_run_records_fts (rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes)
SELECT rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes
FROM agent_run_records;

-- Keep the index in sync with every write from here on, the same
-- insert/delete/update trigger trio SQLite's own FTS5 documentation
-- prescribes for an external-content table. Without these, every row
-- writeRunRecord() inserts after this migration applies would be invisible
-- to search — a stale index is worse than no index, because it looks like it
-- works until the one record that mattered is missing from it.
CREATE TRIGGER IF NOT EXISTS agent_run_records_fts_ai AFTER INSERT ON agent_run_records BEGIN
  INSERT INTO agent_run_records_fts (rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes)
  VALUES (new.rowid, new.task_key, new.task_title, new.attempted, new.rejection_reason, new.reviewer_notes);
END;

CREATE TRIGGER IF NOT EXISTS agent_run_records_fts_ad AFTER DELETE ON agent_run_records BEGIN
  INSERT INTO agent_run_records_fts (agent_run_records_fts, rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes)
  VALUES ('delete', old.rowid, old.task_key, old.task_title, old.attempted, old.rejection_reason, old.reviewer_notes);
END;

CREATE TRIGGER IF NOT EXISTS agent_run_records_fts_au AFTER UPDATE ON agent_run_records BEGIN
  INSERT INTO agent_run_records_fts (agent_run_records_fts, rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes)
  VALUES ('delete', old.rowid, old.task_key, old.task_title, old.attempted, old.rejection_reason, old.reviewer_notes);
  INSERT INTO agent_run_records_fts (rowid, task_key, task_title, attempted, rejection_reason, reviewer_notes)
  VALUES (new.rowid, new.task_key, new.task_title, new.attempted, new.rejection_reason, new.reviewer_notes);
END;
