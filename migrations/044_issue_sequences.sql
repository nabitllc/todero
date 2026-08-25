-- 044_issue_sequences.sql
-- Fixes race condition in task_number generation.
--
-- Problem: two concurrent POSTs both read MAX(task_number) before either commits,
-- resulting in duplicate task_keys (observed: TOD-1585, -1587, -1589, -1647, -1609).
--
-- NOTE (boot-migrations piece): renumbered from 021 -> 044 to resolve a
-- collision with 021_claim_issue_rpc.sql, which stayed at 021 (no dependency
-- either way forced an order; this one moved). Also added the missing
-- `DROP CONSTRAINT IF EXISTS issues_task_key_unique` below — the ADD had no
-- guard, so re-running this file a second time failed outright.
--
-- Fix:
--   1. issue_sequences table — one row per prefix, holds next available number.
--   2. next_issue_number() RPC — atomic UPDATE...RETURNING, no TOCTOU gap.
--   3. UNIQUE constraint on task_key — DB-level last-resort guard.
--   4. Seed sequences from current MAX per prefix.

-- 1. Sequence table
CREATE TABLE IF NOT EXISTS issue_sequences (
  prefix      TEXT    PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

-- 2. Atomic increment function (called by prepareIssueIdentity in route.ts)
CREATE OR REPLACE FUNCTION next_issue_number(p_prefix TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO issue_sequences (prefix, next_number)
  VALUES (p_prefix, 1)
  ON CONFLICT (prefix) DO UPDATE
    SET next_number = issue_sequences.next_number + 1
  RETURNING next_number INTO v_next;
  RETURN v_next;
END;
$$;

-- 3. UNIQUE constraint on task_key (DB-level guard — rejects duplicates outright)
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_task_key_unique;
ALTER TABLE issues ADD CONSTRAINT issues_task_key_unique UNIQUE (task_key);

-- 4. Seed sequences from current max per prefix (run after constraint is live)
INSERT INTO issue_sequences (prefix, next_number)
SELECT
  split_part(task_key, '-', 1) AS prefix,
  MAX(task_number) + 1          AS next_number
FROM issues
WHERE task_key IS NOT NULL
  AND task_number IS NOT NULL
  AND task_key LIKE '%-%'
GROUP BY split_part(task_key, '-', 1)
ON CONFLICT (prefix) DO UPDATE
  SET next_number = EXCLUDED.next_number;
