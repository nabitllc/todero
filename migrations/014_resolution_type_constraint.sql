-- 014_resolution_type_constraint.sql
-- Expand resolution_type check constraint to match VALID_RESOLUTION_TYPES in lib/constants.ts.
--
-- Root cause: the old constraint only allowed 8 values. The code's VALID_RESOLUTION_TYPES
-- had 12, so values like research_completed/database_change/expected_behavior were accepted
-- by the API but then silently rejected by the DB. Also, 44 existing rows have 'by_design'
-- which was never in either list but was used historically before validation was tightened.
--
-- Run this in the Supabase Dashboard → SQL Editor.

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
      'by_design',          -- Legacy: behavior is by design (44 existing rows)
      'expected_behavior',  -- Reported behavior is by design (bug)
      'wont_fix',           -- Acknowledged but won't be fixed
      'not_reproducible',   -- Bug cannot be reproduced
      'deferred',           -- Postponed to future work
      'no_change_required', -- Investigation confirmed no action needed
      'no_action',          -- Legacy alias — 27 existing rows
      'completed',          -- Generic completion (feature, epic)
      'cancelled'           -- Legacy — 39 existing rows; use wont_fix for new ones
    ])
  );
