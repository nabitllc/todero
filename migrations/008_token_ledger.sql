-- TOD-799: Token ledger — cost telemetry per agent per spawn.
-- Not MVP-blocking on Claude Max unlimited, but critical for post-alpha
-- when users bring their own metered API keys.
--
-- Schema is runtime-agnostic (token counts + cost in USD, no Claude-specific
-- fields) so Codex/Cursor/OpenAI adapters can write to the same table.

CREATE TABLE IF NOT EXISTS token_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT NOT NULL,
  task_id       UUID,
  task_key      TEXT,
  runtime       TEXT NOT NULL,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  total_tokens  INTEGER GENERATED ALWAYS AS (COALESCE(input_tokens,0) + COALESCE(output_tokens,0)) STORED,
  cost_usd      NUMERIC(10,6),
  prompt_bytes  INTEGER,
  log_file      TEXT,
  spawned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'spawned'
                  CHECK (status IN ('spawned', 'completed', 'failed', 'killed')),
  metadata      JSONB
);

CREATE INDEX IF NOT EXISTS token_ledger_agent_spawned_idx
  ON token_ledger (agent_id, spawned_at DESC);

CREATE INDEX IF NOT EXISTS token_ledger_task_idx
  ON token_ledger (task_key);

CREATE INDEX IF NOT EXISTS token_ledger_runtime_idx
  ON token_ledger (runtime, spawned_at DESC);

CREATE OR REPLACE VIEW token_ledger_daily_spend AS
SELECT
  DATE_TRUNC('day', spawned_at) AS day,
  agent_id,
  runtime,
  COUNT(*) AS spawn_count,
  SUM(COALESCE(total_tokens, 0)) AS total_tokens,
  SUM(COALESCE(cost_usd, 0)) AS total_cost_usd
FROM token_ledger
GROUP BY DATE_TRUNC('day', spawned_at), agent_id, runtime;

ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;
-- Service role only. No public policies — this is internal telemetry.
