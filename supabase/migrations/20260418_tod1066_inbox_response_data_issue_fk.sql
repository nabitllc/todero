-- TOD-1066 (2026-04-18): add response_data, issue_id FK, and 'explained' status to inbox.
--
-- response_data: resolver-provided JSON payload returned alongside approval decision.
-- issue_id:      links an inbox request to a specific issue (nullable, cascades to NULL on delete).
-- explained:     new status value for when an agent provides an explanation without formal approval.

ALTER TABLE inbox
  ADD COLUMN IF NOT EXISTS response_data JSONB,
  ADD COLUMN IF NOT EXISTS issue_id      UUID REFERENCES issues(id) ON DELETE SET NULL;

-- Expand the status check constraint to include 'explained'.
-- PostgreSQL requires dropping the old constraint and adding a new one.
ALTER TABLE inbox
  DROP CONSTRAINT IF EXISTS inbox_status_check;

ALTER TABLE inbox
  ADD CONSTRAINT inbox_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'timeout', 'explained'));
