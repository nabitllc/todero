-- Agent registration protocol (fleet piece TOD-2381): the "who exists" table.
--
-- Distinct from the per-business `agents` table created in the baseline
-- schema (business_id-scoped, used by app/api/business-agents for the hub /
-- per-project agent-creation flow that the owner has deprioritized) — this is
-- the CLI/runtime self-registration surface: POST /api/connect upserts one
-- row here per agent id, POST /api/agents/{id}/heartbeat (lib/agent-
-- heartbeats.ts) keeps a SEPARATE liveness signal fresh, and every liveness
-- claim /api/agents makes is derived from that heartbeat's `last_seen`
-- timestamp — never from a hardcoded array. `last_seen_at` on this table
-- mirrors the same fact for a client that reads the registration row
-- directly instead of the heartbeat store.

CREATE TABLE IF NOT EXISTS agent_registrations (
  id             TEXT        PRIMARY KEY,
  name           TEXT        NOT NULL,
  runtime        TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'offline'
                              CHECK (status IN ('connected', 'online', 'offline', 'idle', 'busy', 'sleeping', 'error')),
  capabilities   JSONB       NOT NULL DEFAULT '[]',
  connection_id  TEXT,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ
);

-- The dashboard's queries are "every registration" and "this agent's
-- registration"; the id primary key covers the second, this covers the first
-- ordered by recency.
CREATE INDEX IF NOT EXISTS agent_registrations_last_seen_idx ON agent_registrations (last_seen_at DESC);
