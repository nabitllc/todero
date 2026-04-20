-- TOD-729 (2026-04-19): fix blocked_by column storing non-UUID sentinel 'system:rejection_loop'.
--
-- The loop-breaker code (api/issues/route.ts line 1651) stored the literal string
-- 'system:rejection_loop' in the blocked_by column to distinguish rejection-loop blocks
-- from dependency blocks. If blocked_by is type UUID in Postgres, this value is invalid
-- and causes "invalid input syntax for type uuid" errors on any query scanning that table.
--
-- Fix: drop the FK constraint first (it prevents type change), then widen to TEXT.
-- The FK is intentionally not re-added — blocked_by must support non-UUID sentinels.

DO $$
BEGIN
  -- Drop FK constraint if it exists (blocks column type change)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_blocked_by_fkey'
      AND table_name = 'issues'
  ) THEN
    ALTER TABLE issues DROP CONSTRAINT tasks_blocked_by_fkey;
  END IF;

  -- Widen to TEXT if still UUID
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues'
      AND column_name = 'blocked_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE issues ALTER COLUMN blocked_by TYPE TEXT USING blocked_by::TEXT;
  END IF;
END $$;

-- Clean up any remaining sentinel values to NULL
UPDATE issues
SET is_blocked = FALSE, blocked_by = NULL
WHERE blocked_by = 'system:rejection_loop';
