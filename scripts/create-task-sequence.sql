-- MC-210: Create a Postgres sequence for atomic task_number generation.
-- This eliminates the race condition where two concurrent inserts
-- could both SELECT MAX(task_number) + 1 and get the same value.

-- Create the sequence (idempotent)
CREATE SEQUENCE IF NOT EXISTS mc_task_seq;

-- Set the sequence to the current max task_number so new values don't collide
SELECT setval('mc_task_seq', COALESCE((SELECT MAX(task_number) FROM issues), 0));

-- Wrapper function callable via supabase.rpc('next_task_number')
CREATE OR REPLACE FUNCTION next_task_number()
RETURNS integer AS $$
  SELECT nextval('mc_task_seq')::integer;
$$ LANGUAGE sql;
