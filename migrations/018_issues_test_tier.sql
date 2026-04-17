-- Migration 018: add test_tier column to issues
-- test_tier tells the tester how deeply to verify a task before approving.
-- Set by PO during backlog→refined. Required for task, bug, ops types.
-- Values: smoke | integration | e2e

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS test_tier text
  CHECK (test_tier IN ('smoke', 'integration', 'e2e'));

COMMENT ON COLUMN issues.test_tier IS
  'Depth of testing required: smoke (build+spot), integration (new API/component), e2e (user-facing flow)';
