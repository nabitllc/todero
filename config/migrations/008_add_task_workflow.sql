-- Migration 008: Full Task workflow — transitioned_by field + workflow_transitions table
-- Created: 2026-03-30

-- Add transitioned_by (not persisted in normal flow — used for API validation only)
ALTER TABLE issues ADD COLUMN IF NOT EXISTS transitioned_by text;

-- Add new Task workflow status fields
ALTER TABLE issues ADD COLUMN IF NOT EXISTS deployer text;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS auditor text;

-- Canonical workflow transitions table
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_type text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  condition_role text,       -- null = anyone, 'po_or_main', 'assignee', 'reviewer'
  validators jsonb,          -- array of required field names / special validators
  post_functions jsonb,      -- array of {action, params} objects
  created_at timestamptz DEFAULT now()
);

-- Unique constraint to prevent duplicate transition rules
CREATE UNIQUE INDEX IF NOT EXISTS workflow_transitions_type_from_to
  ON workflow_transitions(issue_type, from_status, to_status);

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Task type transitions
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES

-- creation → backlog (handled in POST, included for completeness)
('task', 'creation', 'backlog',
  NULL,
  '["title","project","acceptance_criteria","type"]',
  NULL),

-- backlog → open: po or main only; full DoR validators
('task', 'backlog', 'open',
  'po_or_main',
  '["acceptance_criteria","sprint","priority","assignee","parent_id","reviewer","owner","severity"]',
  '[{"action":"set_assignee","params":{"from_field":"owner"}}]'),

-- open → in_progress: assignee only
('task', 'open', 'in_progress',
  'assignee',
  NULL,
  NULL),

-- open → backlog: any (no condition role enforced here)
('task', 'open', 'backlog',
  NULL,
  NULL,
  NULL),

-- open → closed (decline path)
('task', 'open', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- in_progress → code_review: assignee; implementation evidence required
('task', 'in_progress', 'code_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}}]'),

-- in_progress → product_review: assignee; implementation evidence required
('task', 'in_progress', 'product_review',
  'assignee',
  '["implementation_notes","regression_test","ref_required"]',
  '[{"action":"set_assignee","params":{"from_field":"reviewer"}}]'),

-- in_progress → backlog: builder backs off
('task', 'in_progress', 'backlog',
  NULL,
  NULL,
  NULL),

-- in_progress → open (builder rejecting own work)
('task', 'in_progress', 'open',
  'assignee',
  NULL,
  '[{"action":"set_assignee","params":{"from_field":"owner"}}]'),

-- in_progress → closed (decline path)
('task', 'in_progress', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- code_review → approved: reviewer; requires resolution evidence
('task', 'code_review', 'approved',
  'reviewer',
  '["resolution_type","reviewer_notes","test_status_passed"]',
  '[{"action":"set_assignee","params":{"from_field":"deployer"}},{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

-- code_review → open: reviewer rejects; increment rejection tracking
('task', 'code_review', 'open',
  'reviewer',
  NULL,
  '[{"action":"set_assignee","params":{"from_field":"owner"}},{"action":"increment_rejection","params":{}},{"action":"copy_field","params":{"from":"reviewer_notes","to":"last_rejection_reason"}},{"action":"set_timestamp","params":{"field":"last_rejected_at"}}]'),

-- code_review → closed (decline path)
('task', 'code_review', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- product_review → completed: reviewer approves no-code path
('task', 'product_review', 'completed',
  'reviewer',
  NULL,
  '[{"action":"set_assignee","params":{"from_field":"auditor"}},{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'),

-- product_review → open: reviewer decides code IS needed
('task', 'product_review', 'open',
  'reviewer',
  NULL,
  '[{"action":"set_assignee","params":{"from_field":"owner"}}]'),

-- product_review → closed (decline path)
('task', 'product_review', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- approved → released: pr_url required
('task', 'approved', 'released',
  NULL,
  '["pr_url"]',
  '[{"action":"set_assignee","params":{"from_field":"auditor"}}]'),

-- released → closed: confirmed
('task', 'released', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- completed → closed: confirmed
('task', 'completed', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]'),

-- backlog → closed (early decline)
('task', 'backlog', 'closed',
  NULL,
  NULL,
  '[{"action":"set_assignee","params":{"to":null}}]')

ON CONFLICT (issue_type, from_status, to_status) DO UPDATE SET
  condition_role = EXCLUDED.condition_role,
  validators = EXCLUDED.validators,
  post_functions = EXCLUDED.post_functions;
