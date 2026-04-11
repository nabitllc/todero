-- TOD-764 (2026-04-10): create inbox table for agent approval requests.
--
-- Agents call lib/inbox.ts requestApproval() which inserts a row here.
-- The promise resolves when status changes from 'pending' to 'approved'/'denied'
-- or when expires_at is reached (timeout path).

CREATE TABLE IF NOT EXISTS inbox (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent        TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  context      JSONB,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'denied', 'timeout')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  resolved_by  TEXT
);

-- Index for UI queries: "show pending items sorted by age"
CREATE INDEX IF NOT EXISTS inbox_status_created_idx
  ON inbox (status, created_at DESC)
  WHERE status = 'pending';
