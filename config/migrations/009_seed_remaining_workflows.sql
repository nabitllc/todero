-- Migration 009: Seed Bug, Feature, Epic, Ops, Research workflows
-- Created: 2026-03-30

-- Add bug-specific fields to issues table
ALTER TABLE issues ADD COLUMN IF NOT EXISTS steps_to_reproduce text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS expected_behavior text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS actual_behavior text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS environment text;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Bug type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('bug', 'creation', 'backlog',
  NULL,
  '["title","project","acceptance_criteria","type","steps_to_reproduce","expected_behavior","actual_behavior"]',
  '[]'),

('bug', 'backlog', 'open',
  'po_or_main',
  '["acceptance_criteria","sprint","priority","severity","assignee","parent_id","reviewer","owner","environment"]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('bug', 'backlog', 'closed',
  'po_or_main',
  '["resolution_type","reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":null}}]'),

('bug', 'open', 'in_progress',
  'assignee',
  '[]',
  '[]'),

('bug', 'open', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('bug', 'in_progress', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"source":"reviewer"}}]'),

('bug', 'in_progress', 'product_review',
  'assignee',
  '["implementation_notes"]',
  '[{"action":"set_assignee","params":{"source":"reviewer"}}]'),

('bug', 'in_progress', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('bug', 'code_review', 'approved',
  'reviewer',
  '["resolution_type","reviewer_notes","test_status_passed"]',
  '[{"action":"set_assignee","params":{"source":"deployer"}},{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

('bug', 'code_review', 'open',
  'reviewer',
  '[]',
  '[{"action":"increment_rejection","params":{}},{"action":"copy_field","params":{"from":"reviewer_notes","to":"last_rejection_reason"}},{"action":"set_assignee","params":{"source":"owner"}}]'),

('bug', 'product_review', 'completed',
  'reviewer',
  '["reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":"auditor"}}]'),

('bug', 'product_review', 'open',
  'reviewer',
  '[]',
  '[{"action":"increment_rejection","params":{}},{"action":"copy_field","params":{"from":"reviewer_notes","to":"last_rejection_reason"}},{"action":"set_assignee","params":{"source":"owner"}}]'),

('bug', 'approved', 'released',
  NULL,
  '["pr_url"]',
  '[{"action":"set_assignee","params":{"source":"auditor"}}]'),

('bug', 'completed', 'closed',
  NULL,
  '[]',
  '[{"action":"set_assignee","params":{"source":null}}]'),

('bug', 'released', 'closed',
  NULL,
  '[]',
  '[{"action":"set_assignee","params":{"source":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Feature type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('feature', 'creation', 'backlog',
  NULL,
  '["title","project","type"]',
  '[]'),

('feature', 'backlog', 'defined',
  'po_main_sme',
  '["description","acceptance_criteria","parent_id"]',
  '[]'),

('feature', 'defined', 'open',
  'po_or_main',
  '["sprint","priority","severity","assignee","reviewer","owner"]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('feature', 'defined', 'backlog',
  'po_main_sme',
  '[]',
  '[]'),

('feature', 'backlog', 'closed',
  'po_or_main',
  '["resolution_type","reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":null}}]'),

('feature', 'open', 'in_progress',
  'assignee',
  '[]',
  '[]'),

('feature', 'open', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('feature', 'in_progress', 'product_review',
  'assignee',
  '["implementation_notes","ref_required"]',
  '[{"action":"set_assignee","params":{"source":"reviewer"}}]'),

('feature', 'in_progress', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('feature', 'product_review', 'approved',
  'reviewer',
  '["reviewer_notes","test_status_passed"]',
  '[{"action":"set_assignee","params":{"source":"deployer"}},{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

('feature', 'product_review', 'open',
  'reviewer',
  '[]',
  '[{"action":"increment_rejection","params":{}},{"action":"copy_field","params":{"from":"reviewer_notes","to":"last_rejection_reason"}},{"action":"set_assignee","params":{"source":"owner"}}]'),

('feature', 'approved', 'released',
  NULL,
  '["pr_url"]',
  '[{"action":"set_assignee","params":{"source":"auditor"}}]'),

('feature', 'released', 'closed',
  NULL,
  '[]',
  '[{"action":"set_assignee","params":{"source":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Epic type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('epic', 'creation', 'backlog',
  NULL,
  '["title","project","type","description"]',
  '[]'),

('epic', 'backlog', 'active',
  'po_or_main',
  '["children_exist"]',
  '[]'),

('epic', 'active', 'closed',
  'po_or_main',
  '[]',
  '[{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

('epic', 'backlog', 'closed',
  'po_or_main',
  '["resolution_type","reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Ops type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('ops', 'creation', 'backlog',
  NULL,
  '["title","project","acceptance_criteria","type"]',
  '[]'),

('ops', 'backlog', 'open',
  'po_main_ops',
  '["sprint","assignee","reviewer","owner","priority","severity"]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('ops', 'backlog', 'closed',
  'po_or_main',
  '["resolution_type","reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":null}}]'),

('ops', 'open', 'in_progress',
  'assignee',
  '[]',
  '[]'),

('ops', 'open', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('ops', 'in_progress', 'product_review',
  'assignee',
  '["implementation_notes"]',
  '[{"action":"set_assignee","params":{"source":"reviewer"}}]'),

('ops', 'in_progress', 'backlog',
  'assignee',
  '[]',
  '[{"action":"set_assignee","params":{"source":"owner"}}]'),

('ops', 'product_review', 'completed',
  'reviewer',
  '["reviewer_notes","test_status_passed"]',
  '[{"action":"set_assignee","params":{"source":"auditor"}},{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

('ops', 'product_review', 'open',
  'reviewer',
  '[]',
  '[{"action":"increment_rejection","params":{}},{"action":"copy_field","params":{"from":"reviewer_notes","to":"last_rejection_reason"}},{"action":"set_assignee","params":{"source":"owner"}}]'),

('ops', 'completed', 'closed',
  'assignee_or_ops',
  '["resolution_type"]',
  '[{"action":"set_assignee","params":{"source":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Research type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

('research', 'creation', 'backlog',
  NULL,
  '["title","project","acceptance_criteria","type"]',
  '[]'),

('research', 'backlog', 'open',
  'po_or_main',
  '["sprint","assignee","reviewer","owner"]',
  '[{"action":"set_assignee","params":{"source":"scout"}}]'),

('research', 'backlog', 'closed',
  'po_or_main',
  '["resolution_type","reviewer_notes"]',
  '[{"action":"set_assignee","params":{"source":null}}]'),

('research', 'open', 'in_progress',
  'assignee',
  '[]',
  '[]'),

('research', 'open', 'backlog',
  'assignee',
  '[]',
  '[]'),

('research', 'in_progress', 'completed',
  'scout_only',
  '["implementation_notes","resolution_type"]',
  '[{"action":"notify_discord","params":{"channel":"1487584901678104698"}},{"action":"notify_kaos","params":{}}]'),

('research', 'in_progress', 'backlog',
  'assignee',
  '[]',
  '[]'),

('research', 'completed', 'closed',
  'po_or_main',
  '[]',
  '[{"action":"set_assignee","params":{"source":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;
