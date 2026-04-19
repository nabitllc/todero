-- TOD-841: Add task open→code_review workflow transition
-- Fixes: tasks with work completed while staying in 'open' (no in_progress step)
-- could not advance to code_review because the transition row was missing.
-- Full path: open → code_review → approved
-- Also adds bug: open→code_review for symmetry (same execution family).

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('task', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]'),

('bug', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;
