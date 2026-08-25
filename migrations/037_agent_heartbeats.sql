-- Agent liveness protocol — one row per agent, upserted on every check-in.
--
-- Replaces the process-table scan that used to answer "who is running": that
-- could only ever see agents on the single host serving the dashboard, and it
-- inferred identity by substring-matching prompt text in command lines. An
-- agent now ASSERTS its liveness by POSTing /api/agents/<id>/heartbeat, which
-- works identically for an agent in a container, on another machine, or behind
-- a firewall.
--
-- Columns match what lib/agent-heartbeats.ts writes and reads — nothing here is
-- speculative. `last_seen` is the only required field beyond the id; pid, host
-- and task are whatever the agent chose to report.

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id   TEXT        PRIMARY KEY,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pid        INTEGER,
  host       TEXT,
  task       TEXT
);

-- The dashboard's only query is "every beat, newest first" and the watchdog's
-- is "beats older than N minutes"; both are index scans on last_seen.
CREATE INDEX IF NOT EXISTS agent_heartbeats_last_seen_idx ON agent_heartbeats (last_seen DESC);
