-- 014_resolution_type_constraint.sql
-- Expand resolution_type check constraint to match VALID_RESOLUTION_TYPES in lib/constants.ts.
-- Previously the DB only allowed: cancelled, code_change, completed, config_change,
-- deferred, duplicate, no_action, wont_fix — causing silent rejects for types like
-- research_completed, database_change, documentation, etc. that the code considered valid.

ALTER TABLE issues
  DROP CONSTRAINT IF EXISTS tasks_resolution_type_check;

ALTER TABLE issues
  ADD CONSTRAINT tasks_resolution_type_check CHECK (
    resolution_type IS NULL OR resolution_type = ANY (ARRAY[
      'code_change',        -- Code was written/modified (task, bug, ops)
      'config_change',      -- Configuration/settings changed, no code (ops)
      'database_change',    -- Schema migration, data fix (ops)
      'research_completed', -- Research done, findings documented (research)
      'documentation',      -- Docs written/updated, no code (any)
      'duplicate',          -- Issue is a duplicate of another
      'expected_behavior',  -- Reported behavior is by design (bug)
      'wont_fix',           -- Acknowledged but won't be fixed
      'not_reproducible',   -- Bug cannot be reproduced
      'deferred',           -- Postponed to future work
      'no_change_required', -- Investigation confirmed no action needed (superseded, redundant)
      'no_action',          -- Legacy alias — kept for backward compat
      'completed',          -- Generic completion (feature, epic)
      'cancelled'           -- Legacy — kept for backward compat; use wont_fix for new issues
    ])
  );
