-- MC-348: Add started_at, submitted_at, completed_at, worked_by, regression_test
-- Run via Supabase Dashboard > SQL Editor

ALTER TABLE issues ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS worked_by text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS regression_test text;
