-- TOD-488: Dual Tester + Designer review gate for all code-change tickets

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS tester_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tester_notes text,
  ADD COLUMN IF NOT EXISTS tested_by text,
  ADD COLUMN IF NOT EXISTS tester_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS designer_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS designer_notes text,
  ADD COLUMN IF NOT EXISTS designed_by text,
  ADD COLUMN IF NOT EXISTS designer_reviewed_at timestamptz;
