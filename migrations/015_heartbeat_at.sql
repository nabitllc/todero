-- Migration 015: Add heartbeat_at column to issues table
--
-- heartbeat_at is written by the agent every ~5 min while actively working.
-- The watchdog uses it (when set) instead of started_at to detect dead agents:
--   heartbeat_at < now() - interval '10 minutes'  → agent is dead
-- If null, falls back to started_at < now() - interval '20 minutes'.
--
-- Also tightens stale cutoff: 20 min instead of 30 min for issues with no commit_sha.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

-- Index for the watchdog query: in_progress + heartbeat_at or started_at
CREATE INDEX IF NOT EXISTS idx_issues_heartbeat_at
  ON issues (heartbeat_at)
  WHERE status = 'in_progress';

COMMENT ON COLUMN issues.heartbeat_at IS
  'Last heartbeat written by the working agent (~every 5 min). Null until first heartbeat. Watchdog uses this to detect dead agents within 10 min instead of waiting 30 min for started_at to go stale.';
