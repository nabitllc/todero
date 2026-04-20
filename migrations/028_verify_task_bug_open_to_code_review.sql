-- Migration 028: Verify task/bug open→code_review transitions exist (TOD-841 rebuild)
-- This migration is idempotent. Migration 020 added these rows; this re-applies them
-- with ON CONFLICT DO NOTHING so a fresh DB restore always gets the correct state.
-- The fix resolves: "Invalid transition for task: open → approved"
-- Correct path: open → code_review → approved (no direct open→approved shortcut).
-- Created: 2026-04-20

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

-- task: open → code_review
('task', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]'),

-- bug: open → code_review (same execution family)
('bug', 'open', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]')

ON CONFLICT (issue_type, from_status, to_status) DO NOTHING;
