-- registry-reaches-dispatch piece.
--
-- The vault's Global_Agents/<id>/manifest.json registry (lib/vault-agents.ts)
-- used to be merged into GET /api/agents' response and NOWHERE else: no row
-- was ever written, so lib/agent-queue.ts's hardcoded AGENT_QUEUE_CONFIGS
-- kept sole ownership of model selection and every vault agent answered
-- "Unknown agent" to POST /api/run-agent. This table is the durable half of
-- that fix — lib/agent-manifests.ts writes one row per manifest here on
-- every successful vault scan, and derives dispatchable queue configs from
-- it (falling back to a fresh live scan when the table has not been
-- migrated on this host yet — see that file's ensureVaultDispatchConfigs()).
--
-- Read-only source of truth stays the vault (docs/brain2-integration.md):
-- this table is a CACHE of the vault's own data, never edited by a human or
-- another agent directly, and re-synced from the vault on every scan.

CREATE TABLE IF NOT EXISTS agent_manifests (
  agent_id          TEXT        PRIMARY KEY,
  name              TEXT        NOT NULL,
  description       TEXT,
  tier              TEXT,
  claude_code_alias TEXT,
  preferred         TEXT,
  fallback_local    TEXT,
  local_eligible    BOOLEAN     NOT NULL DEFAULT false,
  tools             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  compatible_with   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  source            TEXT        NOT NULL DEFAULT 'vault',
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_manifests_synced_at_idx ON agent_manifests (synced_at);
