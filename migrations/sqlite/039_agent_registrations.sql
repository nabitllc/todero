-- SQLite dialect of migrations/039_agent_registrations.sql — see that file for
-- why this table exists and how it differs from the baseline's per-business
-- `agents` table. Applied incrementally on top of 000_baseline.sql, same as
-- every other numbered file in this directory (scripts/db-migrate.mjs applies
-- migrations/sqlite/*.sql in filename order, tracked in schema_migrations).
--
-- Dialect notes: jsonb -> JSON_TEXT (lib/db/sqlite-adapter.ts JSON.parses/
-- stringifies these transparently, same convention as agent_heartbeats.task
-- and the other JSON_TEXT columns in 000_baseline.sql). timestamptz -> TEXT
-- holding an ISO-8601 UTC string, so `new Date(row.registered_at)` parses
-- identically to the Postgres path.

CREATE TABLE IF NOT EXISTS agent_registrations (
  id             TEXT      PRIMARY KEY,
  name           TEXT      NOT NULL,
  runtime        TEXT      NOT NULL,
  status         TEXT      NOT NULL DEFAULT 'offline'
                            CHECK (status IN ('connected', 'online', 'offline', 'idle', 'busy', 'sleeping', 'error')),
  capabilities   JSON_TEXT NOT NULL DEFAULT '[]',
  connection_id  TEXT,
  registered_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at   TEXT
);

CREATE INDEX IF NOT EXISTS agent_registrations_last_seen_idx ON agent_registrations (last_seen_at DESC);
