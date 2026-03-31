-- TOD-488: Dual Tester + Designer review gate for all code-change tickets

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS tester_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tester_notes text,
  ADD COLUMN IF NOT EXISTS tested_by text,
  ADD COLUMN IF NOT EXISTS tester_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS designer_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS designer_notes text,
  ADD COLUMN IF NOT EXISTS designed_by text,
  ADD COLUMN IF NOT EXISTS designer_reviewed_at timestamptz;

UPDATE issue_field_definitions
SET auto_set_when = 'On code_review: assignee auto-switches to tester',
    auto_set_to = 'tester',
    set_by = 'api',
    notes = 'Builder submission to code_review always routes through tester while designer reviews in parallel.'
WHERE field_name = 'assignee';

UPDATE issue_field_definitions
SET notes = 'Aggregate review state. pending while either reviewer is outstanding, passed only when tester + designer both pass, failed if either fails.'
WHERE field_name = 'test_status';

DELETE FROM issue_field_definitions
WHERE field_name IN (
  'tester_status', 'tester_notes', 'tested_by', 'tester_reviewed_at',
  'designer_status', 'designer_notes', 'designed_by', 'designer_reviewed_at'
);

INSERT INTO issue_field_definitions (field_name, label, description, data_type, allowed_values, required_for_status, auto_set_when, auto_set_to, set_by, applies_to_types, is_required, is_system, notes)
VALUES
  ('tester_status', 'Tester Status', 'Tester review lane status for code review.', 'enum', '["pending","passed","failed"]'::jsonb, ARRAY['code_review','approved'], 'On move to code_review', 'pending', 'api/tester', ARRAY['task','bug','feature'], false, false, 'Required as part of dual review gate for code-change work.'),
  ('tester_notes', 'Tester Notes', 'Functional and regression review notes from tester.', 'text', NULL, NULL, NULL, NULL, 'tester', ARRAY['task','bug','feature'], false, false, 'Preserved even if the issue returns to in_progress.'),
  ('tested_by', 'Tested By', 'Agent who completed the tester review lane.', 'text', NULL, NULL, 'When tester submits review', 'tester', 'api', ARRAY['task','bug','feature'], false, false, NULL),
  ('tester_reviewed_at', 'Tester Reviewed At', 'Timestamp for tester review completion.', 'timestamptz', NULL, NULL, 'When tester submits review', 'now()', 'api', ARRAY['task','bug','feature'], false, true, NULL),
  ('designer_status', 'Designer Status', 'Designer review lane status for code review.', 'enum', '["pending","passed","failed"]'::jsonb, ARRAY['code_review','approved'], 'On move to code_review', 'pending', 'api/designer', ARRAY['task','bug','feature'], false, false, 'Backend-only work still receives a lighter designer check.'),
  ('designer_notes', 'Designer Notes', 'UI/UX and product-surface review notes from designer.', 'text', NULL, NULL, NULL, NULL, 'designer', ARRAY['task','bug','feature'], false, false, 'Preserved even if the issue returns to in_progress.'),
  ('designed_by', 'Designed By', 'Agent who completed the designer review lane.', 'text', NULL, NULL, 'When designer submits review', 'designer', 'api', ARRAY['task','bug','feature'], false, false, NULL),
  ('designer_reviewed_at', 'Designer Reviewed At', 'Timestamp for designer review completion.', 'timestamptz', NULL, NULL, 'When designer submits review', 'now()', 'api', ARRAY['task','bug','feature'], false, true, NULL);

UPDATE workflow_transitions
SET condition_role = 'assignee',
    validators = ARRAY['implementation_notes', 'regression_test', 'ref_required'],
    post_functions = '[{"action":"set_assignee","params":{"to":"tester"}},{"action":"activate_code_review_agents","params":{}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'in_progress' AND to_status = 'code_review';

UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = ARRAY['resolution_type', 'dual_review_passed'],
    post_functions = '[{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'code_review' AND to_status = 'approved';

UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = NULL,
    post_functions = '[{"action":"set_assignee","params":{"to":"builder"}},{"action":"increment_rejection","params":{}},{"action":"set_timestamp","params":{"field":"last_rejected_at"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'code_review' AND to_status = 'open';

DELETE FROM workflow_transitions
WHERE issue_type = 'task' AND from_status = 'code_review' AND to_status = 'in_progress';

INSERT INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
VALUES ('task', 'code_review', 'in_progress', 'tester_or_designer', NULL, '[{"action":"set_assignee","params":{"to":"builder"}},{"action":"increment_rejection","params":{}},{"action":"set_timestamp","params":{"field":"last_rejected_at"}}]'::jsonb);
