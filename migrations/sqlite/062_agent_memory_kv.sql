-- 062 (sqlite): give `agent_memory` the key/value shape all fourteen of its
--               call sites already write.
--
-- This is the SQLite dialect of migrations/062_agent_memory_kv.sql. Read that
-- file for the decision and the reasoning behind it; this header covers only
-- what differs, which is dialect and idempotence strategy.
--
-- THE DECISION (short form — the long form is in the Postgres copy)
--   Every reader and writer of `agent_memory` in this repo uses `key`/`value`;
--   not one reads it as daily notes. The daily-notes role belongs to
--   `agent_memory_files`, which owns all seven of its call sites. Reshaping
--   makes 14 call sites true and 0 false. So: reshape.
--
-- WHAT THIS FILE CREATES — and it creates exactly what it describes, which is
-- the promise migrations/016_agent_documents.sql broke when it wrote a
-- daily-notes CREATE TABLE under a comment describing a key/value one:
--   agent_memory(id, agent_id, key, value, updated_at) with UNIQUE(agent_id, key).
--
-- DIALECT NOTES
--   * SQLite has no DO blocks and no conditional DDL, so the Postgres copy's
--     shape branch cannot be expressed here. It does not need to be: on SQLite
--     there is only ever ONE starting shape. migrations/sqlite/000_baseline.sql
--     is the only file that has ever created this table, and it creates the
--     daily-notes shape.
--   * `value` is declared JSON_TEXT, not TEXT, and that is load-bearing:
--     lib/db/sqlite-adapter.ts reads each table's declared column types once
--     (kindsFor()) and JSON.parses columns whose declared type starts with
--     "JSON" on the way out, JSON.stringifying objects on the way in. A plain
--     TEXT column would hand every caller a raw string where the Postgres host
--     hands back an object, and lib/loop-breaker.ts readMemoryValue<T>() —
--     which returns the value as T with no parse of its own — would silently
--     get the wrong type. JSON_TEXT is what makes the two hosts answer alike.
--     (decodeValue() falls back to the raw string when a value is not valid
--     JSON, so lib/theme.ts's bare 'dark' still round-trips here.)
--   * UNIQUE(agent_id, key) is required, not cosmetic: every writer passes
--     `{ onConflict: 'agent_id,key' }`, which compiles to
--     `ON CONFLICT (agent_id, key) DO UPDATE`, and SQLite rejects that without
--     a matching unique index.
--
-- CARRYOVER
--   The first statement copies any daily-notes rows into `agent_memory_files`
--   before the table is dropped. On this host that copy is provably a no-op —
--   `agent_memory_files` is created by the same baseline with the identical
--   column set, and no call site in the repo has ever written daily notes to
--   `agent_memory` — and it was observed empty (0 rows) before this migration
--   was written. It is kept anyway: it costs nothing, and "provably empty" is
--   an argument that stops being true the moment someone seeds the table by
--   hand. Never drop a table on the strength of a claim you are not enforcing.
--
-- IDEMPOTENCE
--   The runner records what it applied in `schema_migrations`, so this file
--   runs exactly once — the same guarantee migrations/sqlite/057 relies on for
--   its bare ADD COLUMNs. Statement ORDER is what makes an accidental re-run
--   safe rather than destructive: the carryover SELECT names `memory_type`,
--   which no longer exists after this migration, so a second run fails on the
--   FIRST statement, before the DROP. The runner wraps each file in a
--   transaction and rolls back on error, so a re-run changes nothing and says
--   so loudly. That is the property to preserve if this file is ever edited:
--   the copy must stay ahead of the drop.

INSERT OR IGNORE INTO agent_memory_files (agent_id, memory_type, date_key, content, updated_at)
  SELECT agent_id, memory_type, date_key, content, updated_at FROM agent_memory;

DROP TABLE agent_memory;

CREATE TABLE agent_memory (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id   TEXT      NOT NULL,
  key        TEXT      NOT NULL,
  value      JSON_TEXT,
  updated_at TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (agent_id, key)
);

-- Every read filters on `key`, often across all agents at once
-- (lib/agent-heartbeats.ts selects .eq('key','heartbeat') with no agent_id).
CREATE INDEX IF NOT EXISTS agent_memory_key_idx ON agent_memory (key);
