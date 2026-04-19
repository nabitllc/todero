-- TOD-XXX: Add deployer_status to issues table.
-- Deployer marks issues 'ready' after rebasing+building the branch.
-- PR Window only ships branches where deployer_status = 'ready'.
-- Reset to null when issue leaves approved (back to in_progress or forward to released).

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS deployer_status TEXT
    CHECK (deployer_status IN ('ready', 'failed'));
