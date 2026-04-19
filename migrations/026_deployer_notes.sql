-- TOD-XXX: Add deployer_notes to issues table.
-- Deployer writes failure details here when bouncing an issue back to open.
-- Builder/ops agents read this field on pickup to understand what to fix.

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS deployer_notes TEXT;
