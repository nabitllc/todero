-- Run this in Supabase SQL Editor
-- Project: Kaos Ops (twthgapiouiqhavrcnry)
-- URL: https://supabase.com/dashboard/project/twthgapiouiqhavrcnry/editor

-- 1. New columns on tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS resolution_type text 
  CHECK (resolution_type IN ('code_change','config_change','wont_fix','canceled','duplicate','cannot_reproduce','by_design'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS feature_branch text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pr_url text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS test_status text 
  CHECK (test_status IN ('none','pending','passed','failed')) DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_criteria text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS steps_to_reproduce text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS expected_behavior text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_behavior text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS environment text;

-- 2. Expand type enum
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_type_check 
  CHECK (type IN ('feature','bug','ops','research','chore','test','refactor'));

-- 3. Sprints table
CREATE TABLE IF NOT EXISTS sprints (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  project text NOT NULL,
  goal text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text CHECK (status IN ('planned','active','complete')) DEFAULT 'planned',
  created_at timestamptz DEFAULT now()
);

-- 4. Sprint-1
INSERT INTO sprints (name, project, goal, start_date, end_date, status) VALUES
('sprint-1', 'Vespera', 'Ship Vespera MVP — live, tested, publicly accessible', '2026-03-28', '2026-03-28', 'active'),
('sprint-1', 'Infrastructure', 'Deploy DoR/DoD, sprint system, 1-day sprint cadence', '2026-03-28', '2026-03-28', 'active'),
('sprint-1', 'Kemuni', 'Kemuni SME activation + kernel planning', '2026-03-28', '2026-03-28', 'planned')
ON CONFLICT DO NOTHING;
