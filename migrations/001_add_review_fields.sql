-- MC-313: Add commit_sha, implementation_notes, reviewer_notes to issues table
-- Run via Supabase Dashboard > SQL Editor

ALTER TABLE issues ADD COLUMN IF NOT EXISTS commit_sha text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS implementation_notes text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reviewer_notes text;

-- Constraints
-- NOTE (schema-migrations piece): this migration renamed the constraint from
-- sprint_required_if_not_backlog to backlog_no_sprint but only ever dropped
-- the OLD name — re-running against a database that already has
-- backlog_no_sprint (i.e. every install to date, since this ran once by hand)
-- failed with "constraint already exists". Idempotency requires dropping the
-- name this migration itself creates before recreating it.
ALTER TABLE issues DROP CONSTRAINT IF EXISTS sprint_required_if_not_backlog;
ALTER TABLE issues DROP CONSTRAINT IF EXISTS backlog_no_sprint;
ALTER TABLE issues ADD CONSTRAINT backlog_no_sprint CHECK (NOT (status = 'backlog' AND sprint IS NOT NULL));
ALTER TABLE issues DROP CONSTRAINT IF EXISTS sprint_required_if_open;
ALTER TABLE issues ADD CONSTRAINT sprint_required_if_open CHECK (status NOT IN ('open','in_progress','in_review') OR sprint IS NOT NULL);
