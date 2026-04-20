-- TOD-729 (2026-04-19): fix blocked_by column storing non-UUID sentinel 'system:rejection_loop'.
--
-- The loop-breaker code (api/issues/route.ts line 1651) stored the literal string
-- 'system:rejection_loop' in the blocked_by column to distinguish rejection-loop blocks
-- from dependency blocks. If blocked_by is type UUID in Postgres, this value is invalid
-- and causes "invalid input syntax for type uuid" errors on any query scanning that table.
--
-- Fix: if the column is TEXT, this NULL-ifies those rows so normal queries work.
-- If the column is UUID, PostgreSQL already rejects these values — this is a no-op.

-- Alter blocked_by to TEXT to allow non-UUID sentinels (if it isn't already)
-- and clear any existing non-UUID values.
DO $$
BEGIN
  -- Check column type; alter only if it's uuid
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues'
      AND column_name = 'blocked_by'
      AND data_type = 'uuid'
  ) THEN
    -- Alter to text so sentinels can be stored
    ALTER TABLE issues ALTER COLUMN blocked_by TYPE TEXT USING blocked_by::TEXT;
  END IF;
END $$;

-- Clean up any remaining sentinel values to NULL
UPDATE issues
SET is_blocked = FALSE, blocked_by = NULL
WHERE blocked_by = 'system:rejection_loop';
