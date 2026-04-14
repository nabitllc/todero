-- Fix duplicate task_key bug (TOD-1317 was assigned to two different issues)
-- Race condition: next_task_number RPC doesn't exist, fallback uses MAX() which is racy.
-- Applied manually 2026-04-13: renamed duplicate to TOD-1319.

-- Step 1: Fix existing duplicate (already applied via API)
-- UPDATE issues SET task_key = 'TOD-1319', task_number = 1319
-- WHERE id = 'a7eb9684-e273-4ca2-ab74-a3eeed4c86ae' AND task_key = 'TOD-1317';

-- Step 2: Add unique constraint (run this on Supabase dashboard SQL editor)
ALTER TABLE issues ADD CONSTRAINT issues_task_key_unique UNIQUE (task_key);
