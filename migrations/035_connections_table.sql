-- Connections table for storing encrypted integration credentials.
-- Values are AES-256 encrypted at the application layer; never stored in plaintext.

CREATE TABLE IF NOT EXISTS connections (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT        NOT NULL,
  type             TEXT        NOT NULL CHECK (type IN ('github', 'openai', 'anthropic', 'openrouter', 'webhook')),
  encrypted_value  TEXT        NOT NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS connections_workspace_idx ON connections (workspace_id);
CREATE INDEX IF NOT EXISTS connections_type_idx      ON connections (type);
CREATE INDEX IF NOT EXISTS connections_status_idx    ON connections (status);
