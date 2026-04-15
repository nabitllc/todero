-- Migration 004: Create issue_field_definitions table
-- Canonical reference for all issue fields in Mission Control
-- Created: 2026-03-30

CREATE TABLE IF NOT EXISTS issue_field_definitions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  field_name text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL,
  data_type text NOT NULL, -- text, uuid, timestamptz, boolean, integer, enum
  allowed_values text[], -- for enum fields
  required_for_status text[], -- statuses where this field is required
  auto_set_when text, -- description of when auto-set
  auto_set_to text, -- what it's set to
  set_by text, -- 'builder', 'api', 'system', 'user', 'tester', etc.
  applies_to_types text[], -- issue types this field applies to (null = all)
  is_required boolean DEFAULT false,
  is_system boolean DEFAULT false, -- true = managed by system, not user-editable
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed all 36 issue field definitions
INSERT INTO issue_field_definitions
  (field_name, label, description, data_type, allowed_values, required_for_status, auto_set_when, auto_set_to, set_by, applies_to_types, is_required, is_system, notes)
VALUES
  -- 1. id
  ('id', 'ID', 'Unique issue identifier', 'uuid',
   NULL, NULL, 'On creation', 'gen_random_uuid()', 'system', NULL, true, true, NULL),

  -- 2. title
  ('title', 'Title', 'Short descriptive title of the issue', 'text',
   NULL, ARRAY['open','in_progress','in_review','done'], NULL, NULL, 'user', NULL, true, false, NULL),

  -- 3. description
  ('description', 'Description', 'Detailed description of the work', 'text',
   NULL, ARRAY['open'], NULL, NULL, 'user/po', NULL, false, false, NULL),

  -- 4. acceptance_criteria
  ('acceptance_criteria', 'Acceptance Criteria', 'What done looks like — conditions that must be met', 'text',
   NULL, ARRAY['open'], NULL, NULL, 'user/po', NULL, false, false, NULL),

  -- 5. type
  ('type', 'Type', 'Issue type determining workflow', 'enum',
   ARRAY['epic','feature','task','bug','ops','research'], ARRAY['open'], NULL, NULL, 'user', NULL, true, false, NULL),

  -- 6. status
  ('status', 'Status', 'Current workflow state', 'enum',
   ARRAY['backlog','defined','open','in_progress','in_review','done','cancelled'], NULL, NULL, NULL, 'api', NULL, true, true, NULL),

  -- 7. priority
  ('priority', 'Priority', 'Business urgency', 'enum',
   ARRAY['critical','high','medium','low'], ARRAY['open'], NULL, NULL, 'user', NULL, true, false, NULL),

  -- 8. severity
  ('severity', 'Severity (formerly test_tier)', 'Risk level of the change — determines reviewer', 'enum',
   ARRAY['S0','S1','S2','S3'], ARRAY['in_review'], 'Set by Builder before in_review', NULL, 'builder', ARRAY['task','bug'], false, false,
   'S0=Critical/user-facing, S1=High/API-schema, S2=Medium/config-infra, S3=Low/style-copy'),

  -- 9. assignee
  ('assignee', 'Assignee', 'Agent or person responsible', 'text',
   NULL, ARRAY['open'], 'On in_review: auto-set based on severity', 'severity-based', 'api', NULL, false, false, NULL),

  -- 10. project
  ('project', 'Project', 'Which project this belongs to', 'text',
   NULL, ARRAY['open'], NULL, NULL, 'user', NULL, true, false, NULL),

  -- 11. sprint
  ('sprint', 'Sprint', 'Sprint date (YYYY-MM-DD)', 'text',
   NULL, ARRAY['open'], NULL, NULL, 'user', NULL, false, false, 'Required for open, forbidden for backlog'),

  -- 12. parent_id
  ('parent_id', 'Parent', 'Parent issue ID (feature→epic, task→feature)', 'uuid',
   NULL, ARRAY['open'], NULL, NULL, 'user', ARRAY['task','bug','feature'], false, false, NULL),

  -- 13. started_at
  ('started_at', 'Started At', 'When work began', 'timestamptz',
   NULL, NULL, 'On → in_progress (first time only)', 'NOW()', 'system', NULL, false, true, NULL),

  -- 14. worked_by
  ('worked_by', 'Worked By', 'Agent who last moved to in_progress', 'text',
   NULL, NULL, 'On → in_progress', 'current assignee', 'system', NULL, false, true, NULL),

  -- 15. submitted_at
  ('submitted_at', 'Submitted At', 'When submitted for review', 'timestamptz',
   NULL, NULL, 'On → in_review', 'NOW()', 'system', NULL, false, true, NULL),

  -- 16. completed_at
  ('completed_at', 'Completed At', 'When marked done', 'timestamptz',
   NULL, NULL, 'On → done', 'NOW()', 'system', NULL, false, true, NULL),

  -- 17. regression_test
  ('regression_test', 'Regression Test', 'Whether regression testing was performed', 'enum',
   ARRAY['yes','no','na'], ARRAY['in_review'], 'Required before in_review', NULL, 'builder', ARRAY['task','bug'], false, false, NULL),

  -- 18. commit_sha
  ('commit_sha', 'Commit SHA', 'Git commit hash for this change', 'text',
   NULL, ARRAY['in_review'], NULL, NULL, 'builder', ARRAY['task','bug'], false, false, NULL),

  -- 19. feature_branch
  ('feature_branch', 'Feature Branch', 'Git branch name', 'text',
   NULL, NULL, NULL, NULL, 'builder', ARRAY['task','bug','feature'], false, false, NULL),

  -- 20. pr_url
  ('pr_url', 'PR URL', 'GitHub pull request URL', 'text',
   NULL, NULL, NULL, NULL, 'system/kaos', NULL, false, false, NULL),

  -- 21. implementation_notes
  ('implementation_notes', 'Implementation Notes', 'Notes from builder about what was done', 'text',
   NULL, ARRAY['in_review'], NULL, NULL, 'builder', ARRAY['task','bug'], false, false, NULL),

  -- 22. reviewer_notes
  ('reviewer_notes', 'Reviewer Notes', 'Feedback from reviewer', 'text',
   NULL, ARRAY['done'], NULL, NULL, 'tester/designer/po', NULL, false, false, NULL),

  -- 23. test_status
  ('test_status', 'Test Status', 'Result of reviewer''s assessment', 'enum',
   ARRAY['none','passed','failed','skipped'], NULL, NULL, 'none', 'system', NULL, false, true, NULL),

  -- 24. resolution_type
  ('resolution_type', 'Resolution Type', 'How the issue was resolved', 'enum',
   ARRAY['code_change','config_change','no_action','duplicate','by_design','wont_fix'], ARRAY['done'], NULL, NULL, 'user/agent', NULL, false, false, NULL),

  -- 25. due_date
  ('due_date', 'Due Date', 'Optional deadline', 'timestamptz',
   NULL, NULL, NULL, NULL, 'user', NULL, false, false, NULL),

  -- 26. blocked_by
  ('blocked_by', 'Blocked By', 'Issue ID this is blocked by', 'uuid',
   NULL, NULL, NULL, NULL, 'user', NULL, false, false, NULL),

  -- 27. steps_to_reproduce
  ('steps_to_reproduce', 'Steps to Reproduce', 'For bugs: reproduction steps', 'text',
   NULL, ARRAY['open'], NULL, NULL, 'user', ARRAY['bug'], false, false, NULL),

  -- 28. expected_behavior
  ('expected_behavior', 'Expected Behavior', 'For bugs: what should happen', 'text',
   NULL, NULL, NULL, NULL, 'user', ARRAY['bug'], false, false, NULL),

  -- 29. actual_behavior
  ('actual_behavior', 'Actual Behavior', 'For bugs: what actually happens', 'text',
   NULL, NULL, NULL, NULL, 'user', ARRAY['bug'], false, false, NULL),

  -- 30. environment
  ('environment', 'Environment', 'For bugs: where it was found', 'text',
   NULL, NULL, NULL, NULL, 'user', ARRAY['bug'], false, false, NULL),

  -- 31. task_key
  ('task_key', 'Task Key', 'Human-readable ID (e.g. MC-42)', 'text',
   NULL, NULL, 'On creation', 'auto-generated', 'system', NULL, false, true, NULL),

  -- 32. task_number
  ('task_number', 'Task Number', 'Sequential number within project', 'integer',
   NULL, NULL, 'On creation', 'auto-increment', 'system', NULL, false, true, NULL),

  -- 33. business_id
  ('business_id', 'Business ID', 'Linked business/org ID', 'uuid',
   NULL, NULL, NULL, NULL, 'system', NULL, false, false, NULL),

  -- 34. sprint_id
  ('sprint_id', 'Sprint ID', 'Linked sprint record ID', 'uuid',
   NULL, NULL, NULL, NULL, 'system', NULL, false, false, NULL),

  -- 35. created_at
  ('created_at', 'Created At', 'When issue was created', 'timestamptz',
   NULL, NULL, 'On creation', 'NOW()', 'system', NULL, false, true, NULL),

  -- 36. updated_at
  ('updated_at', 'Updated At', 'Last update timestamp', 'timestamptz',
   NULL, NULL, 'On any update', 'NOW()', 'system', NULL, false, true, NULL)

ON CONFLICT (field_name) DO NOTHING;
