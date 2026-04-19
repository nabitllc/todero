-- Migration 020: Add task open→code_review transition (TOD-841)
-- Fixes: tasks with tester approval recorded while in 'open' status
-- cannot advance because the workflow_transitions table had no open→code_review row.
-- The full path is: open → code_review → approved (code_review→approved already exists).
-- Also adds bug: open→code_review for symmetry (same execution family).
-- Created: 2026-04-18

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

-- task: open → code_review (skip in_progress when task was worked without status update)
('task', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]'),

-- bug: open → code_review (same execution family as task)
('bug', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;
