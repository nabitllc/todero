-- 065 (sqlite): what each agent is RESPONSIBLE for, and who answers when an
--               area stalls.
--
-- This is the SQLite dialect of migrations/065_agent_responsibilities.sql. Read
-- that file for the decision — why a row per (business_id, area, agent_id)
-- rather than a column per agent, why `level` is two values and not RACI's
-- four, why `area` is validated at the write path instead of in a CHECK, and
-- why a responsibility is not a capability. This header covers only what
-- differs, which is dialect.
--
-- DIALECT NOTES
--   * `created_at`/`updated_at` are TEXT with a strftime default, the shape
--     migrations/sqlite/058_hub_settings.sql uses. lib/db/sqlite-adapter.ts
--     reads declared column types to decide what to JSON-decode on the way out;
--     TEXT is what makes these come back as ISO strings, matching what the
--     Postgres host returns for TIMESTAMPTZ through the same seam.
--   * The CHECK on `level` is supported by SQLite unchanged and is kept
--     verbatim, so the two hosts refuse exactly the same rows.
--   * The partial unique index (`WHERE level = 'accountable'`) is supported by
--     SQLite 3.8.0+ and is the load-bearing constraint of this table, not an
--     optimisation: without it two agents could both be accountable for one
--     area, which means nobody is. better-sqlite3 ships far newer than 3.8, and
--     `npm run db:migrate` aborting here would be the correct failure if it did
--     not.
--   * No foreign key to `businesses` — same as 058. The seam does not model FKs
--     and `business_id` is TEXT on all three adapters.
--
-- IDEMPOTENCE
--   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS throughout, and the
--   runner records the filename in `schema_migrations` so it runs once anyway.
--   Re-running is a no-op in both mechanisms independently.
--
-- NOTHING IS SEEDED, and nothing consults these rows yet — see the Postgres
-- copy's closing two paragraphs. Both facts are load-bearing and both are
-- stated on screen by components/tabs/ResponsibilitiesCard.tsx.

CREATE TABLE IF NOT EXISTS agent_responsibilities (
  business_id TEXT NOT NULL,
  area        TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('accountable', 'responsible')),
  note        TEXT,
  assigned_by TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (business_id, area, agent_id)
);

-- The constraint that makes "who answers when this stalls" single-valued.
-- Partial, because `responsible` is intentionally many-per-area.
CREATE UNIQUE INDEX IF NOT EXISTS agent_responsibilities_one_accountable_idx
  ON agent_responsibilities (business_id, area)
  WHERE level = 'accountable';

-- "What does this agent own?" — the Fleet detail direction of the same table.
CREATE INDEX IF NOT EXISTS agent_responsibilities_agent_idx
  ON agent_responsibilities (business_id, agent_id);
