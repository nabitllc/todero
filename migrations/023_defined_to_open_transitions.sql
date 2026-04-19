-- TOD-618: Add defined→open workflow transitions for all issue types.
-- PO grooms issues in 'defined' status and transitions directly to 'open'.
-- This formalizes 'defined' as the canonical post-creation staging status.
--
-- condition_role = 'po_or_main' — PO is the grooming owner; kaos/michael can override.
-- Validators mirror the corresponding backlog→open transitions.
-- post_functions: set_assignee from owner (same as backlog→open pattern).

-- TASK: defined→open
INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES (
  'task', 'defined', 'open',
  'po_or_main',
  ARRAY['acceptance_criteria','sprint','priority','assignee','parent_id','reviewer','owner','severity'],
  '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
)
ON CONFLICT (issue_type, from_status, to_status) DO UPDATE
  SET condition_role  = EXCLUDED.condition_role,
      validators      = EXCLUDED.validators,
      post_functions  = EXCLUDED.post_functions;

-- BUG: defined→open
INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES (
  'bug', 'defined', 'open',
  'po_or_main',
  ARRAY['acceptance_criteria','sprint','priority','severity','assignee','parent_id','reviewer','owner','environment'],
  '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
)
ON CONFLICT (issue_type, from_status, to_status) DO UPDATE
  SET condition_role  = EXCLUDED.condition_role,
      validators      = EXCLUDED.validators,
      post_functions  = EXCLUDED.post_functions;

-- FEATURE: defined→open (children required — enforced in route.ts V3 guard)
INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES (
  'feature', 'defined', 'open',
  'po_or_main',
  ARRAY['acceptance_criteria','sprint','priority','assignee','reviewer','owner'],
  '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
)
ON CONFLICT (issue_type, from_status, to_status) DO UPDATE
  SET condition_role  = EXCLUDED.condition_role,
      validators      = EXCLUDED.validators,
      post_functions  = EXCLUDED.post_functions;

-- OPS: defined→open
INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES (
  'ops', 'defined', 'open',
  'po_or_main',
  ARRAY['sprint','assignee','reviewer','owner','priority','severity'],
  '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
)
ON CONFLICT (issue_type, from_status, to_status) DO UPDATE
  SET condition_role  = EXCLUDED.condition_role,
      validators      = EXCLUDED.validators,
      post_functions  = EXCLUDED.post_functions;

-- RESEARCH: defined→open (no parent_id required, no reviewer/owner enforced)
INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES (
  'research', 'defined', 'open',
  'po_or_main',
  ARRAY['acceptance_criteria','sprint','priority','assignee'],
  '[{"action":"set_assignee","params":{"source":"assignee"}}]'::jsonb
)
ON CONFLICT (issue_type, from_status, to_status) DO UPDATE
  SET condition_role  = EXCLUDED.condition_role,
      validators      = EXCLUDED.validators,
      post_functions  = EXCLUDED.post_functions;
