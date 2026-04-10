-- TOD-765: Loop Breaker — per-agent consecutive failure tracking
-- NOTE: This table provides dedicated storage for agent failure counts.
-- If DDL access is unavailable, the /api/agent-failures route falls back
-- to agent_memory (key='failure_tracking') as a compatible store.

CREATE TABLE IF NOT EXISTS agent_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        text NOT NULL UNIQUE,
  failure_count   int  NOT NULL DEFAULT 0,
  last_error_hash text,
  last_error_msg  text,
  last_failure_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Reset failure_count to 0 on agent success
-- Usage: UPDATE agent_failures SET failure_count = 0, last_error_hash = NULL,
--        last_error_msg = NULL, updated_at = now() WHERE agent_id = '<id>';
