-- TOD-XXX (2026-04-10): add is_blocked + fail_count columns.
--
-- DORMANT BUG — the MC API (/api/issues/route.ts) already wrote to these
-- columns (lines 1015-1020 for fail_count, line 1017 for is_blocked), but
-- Supabase was rejecting every write with "column does not exist". The code
-- path existed for the 3-strike loop breaker but silently failed.
--
-- Fixing now so the lock icon on Board cards lights up correctly and the
-- Inbox (TOD-792 epic) can eventually trigger on is_blocked=true.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS fail_count INTEGER NOT NULL DEFAULT 0;

-- Index for "show me all blocked issues" queries from the UI + Inbox
CREATE INDEX IF NOT EXISTS issues_blocked_idx
  ON issues (is_blocked, status)
  WHERE is_blocked = TRUE;

-- Backfill: any existing issue with rejection_count >= 3 or fail_count will
-- need to be caught up. rejection_count is the dual-review counter; fail_count
-- doesn't exist yet so it starts at 0.
UPDATE issues
SET is_blocked = TRUE
WHERE rejection_count >= 3 AND is_blocked = FALSE;

-- Note: rejection_count is NOT reset on is_blocked=false clearing.
-- Per Michael (2026-04-10), the counter persists as an audit trail for
-- retro analysis — "knowing what went wrong helps agents learn."
