-- registry-reaches-dispatch piece — mirrors migrations/055_agent_manifests.sql
-- for the sqlite adapter (sqlite-adapter piece). See that file for why.
-- Dialect notes: jsonb -> JSON_TEXT, boolean -> BOOLEAN — lib/db/sqlite-adapter.ts
-- reads each table's declared column types from SQLite's own catalogue and
-- decodes JSON_TEXT back into an array/object and BOOLEAN back into true/false,
-- the same convention every other JSON/boolean column in this schema follows.

CREATE TABLE IF NOT EXISTS agent_manifests (
  agent_id          TEXT      PRIMARY KEY,
  name              TEXT      NOT NULL,
  description       TEXT,
  tier              TEXT,
  claude_code_alias TEXT,
  preferred         TEXT,
  fallback_local    TEXT,
  local_eligible    BOOLEAN   NOT NULL DEFAULT 0,
  tools             JSON_TEXT NOT NULL DEFAULT '[]',
  compatible_with   JSON_TEXT NOT NULL DEFAULT '[]',
  source            TEXT      NOT NULL DEFAULT 'vault',
  synced_at         TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS agent_manifests_synced_at_idx ON agent_manifests (synced_at);
