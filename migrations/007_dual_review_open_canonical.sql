-- TOD-742: Dual-review failure must return to open, not in_progress.
-- Fix bug/ops code_review transitions to match task pattern:
--   condition_role = tester_or_designer, dual_review_passed validator,
--   and consistent post_functions for rejection handling.

-- BUG: code_review → open — align with task (was condition_role=reviewer)
UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = ARRAY['reviewer_notes'],
    post_functions = '[
      {"action":"set_assignee","params":{"source":"owner"}},
      {"action":"increment_rejection","params":{}},
      {"action":"set_timestamp","params":{"field":"last_rejected_at"}}
    ]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'code_review' AND to_status = 'open';

-- BUG: code_review → approved — align with task (was condition_role=reviewer, test_status_passed)
UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = ARRAY['resolution_type','reviewer_notes','dual_review_passed'],
    post_functions = '[
      {"action":"set_assignee","params":{"source":"deployer"}},
      {"action":"notify_discord","params":{"channel":"1487584901678104698"}}
    ]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'code_review' AND to_status = 'approved';

-- OPS: code_review → open — add tester_or_designer role + post_functions (was null/empty)
UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = ARRAY['reviewer_notes'],
    post_functions = '[
      {"action":"set_assignee","params":{"source":"owner"}},
      {"action":"increment_rejection","params":{}},
      {"action":"set_timestamp","params":{"field":"last_rejected_at"}}
    ]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'code_review' AND to_status = 'open';

-- OPS: code_review → approved — add tester_or_designer + dual_review_passed (was null)
UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = ARRAY['dual_review_passed'],
    post_functions = '[
      {"action":"set_assignee","params":{"source":"deployer"}}
    ]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'code_review' AND to_status = 'approved';
