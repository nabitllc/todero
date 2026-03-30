-- MC-313: Add commit_sha, implementation_notes, reviewer_notes to issues table
-- Run via Supabase Dashboard > SQL Editor

ALTER TABLE issues ADD COLUMN IF NOT EXISTS commit_sha text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS implementation_notes text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS reviewer_notes text;

-- Constraints
ALTER TABLE issues DROP CONSTRAINT IF EXISTS sprint_required_if_not_backlog;
ALTER TABLE issues ADD CONSTRAINT backlog_no_sprint CHECK (NOT (status = 'backlog' AND sprint IS NOT NULL));
ALTER TABLE issues DROP CONSTRAINT IF EXISTS sprint_required_if_open;
ALTER TABLE issues ADD CONSTRAINT sprint_required_if_open CHECK (status NOT IN ('open','in_progress','in_review') OR sprint IS NOT NULL);
