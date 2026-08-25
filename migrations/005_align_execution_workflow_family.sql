-- Align task/bug/ops execution workflow family with agreed 2026-04-04 orchestration.
-- Safe to run after workflow_transitions exists.
-- Research intentionally stays separate.
--
-- NOTE (schema-migrations piece): `validators` is JSONB. The original file
-- wrote plain `ARRAY[...]` (a text[] literal) into it, which only worked
-- historically because this file already ran against production before this
-- repo had a migrations/000_baseline_schema.sql to replay from zero.
-- Wrapped every such assignment in `to_jsonb(...)` — same array of strings,
-- correctly typed — so a fresh clone applying migrations in order doesn't
-- fail on `column "validators" is of type jsonb but expression is of type
-- text[]`. Already-applied production is untouched: schema_migrations
-- records this file as applied there, so it never re-runs.

-- Queue-family rules reflected here:
-- - owner + reviewer required before backlog/defined -> open
-- - open/in_progress work belongs to current worker / owner
-- - in_progress -> code_review routes assignee to reviewer
-- - in_progress -> product_review or backlog routes assignee to po
-- - code_review -> approved requires dual review pass for execution issues
-- - approved -> released routes assignee to deployer first, then released -> auditor
-- - product_review -> completed routes assignee to auditor
-- - closed clears assignee

-- TASK ----------------------------------------------------------------------
UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['acceptance_criteria','sprint','priority','assignee','parent_id','reviewer','owner','severity']),
    post_functions = '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'backlog' AND to_status = 'open';

UPDATE workflow_transitions
SET post_functions = '[
  {"action":"set_assignee","params":{"source":"reviewer"}},
  {"action":"activate_code_review_agents","params":{}}
]'::jsonb
WHERE issue_type = 'task' AND from_status = 'in_progress' AND to_status = 'code_review';

UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['implementation_notes']),
    post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'in_progress' AND to_status = 'product_review';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'in_progress' AND to_status = 'backlog';

UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = to_jsonb(ARRAY['dual_review_passed']),
    post_functions = '[
      {"action":"set_assignee","params":{"source":"deployer"}},
      {"action":"notify_discord","params":{"channel":"1487584901678104698"}}
    ]'::jsonb
WHERE issue_type = 'task' AND from_status = 'code_review' AND to_status = 'approved';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"auditor"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'approved' AND to_status = 'released';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"auditor"}}]'::jsonb
WHERE issue_type = 'task' AND from_status = 'product_review' AND to_status IN ('completed','closed');

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":null}}]'::jsonb
WHERE issue_type = 'task' AND to_status = 'closed';

-- BUG -----------------------------------------------------------------------
UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['acceptance_criteria','sprint','priority','severity','assignee','parent_id','reviewer','owner','environment']),
    post_functions = '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'backlog' AND to_status = 'open';

UPDATE workflow_transitions
SET post_functions = '[
  {"action":"set_assignee","params":{"source":"reviewer"}},
  {"action":"activate_code_review_agents","params":{}}
]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'in_progress' AND to_status = 'code_review';

UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['implementation_notes']),
    post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'in_progress' AND to_status = 'product_review';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'in_progress' AND to_status = 'backlog';

UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = to_jsonb(ARRAY['dual_review_passed']),
    post_functions = '[
      {"action":"set_assignee","params":{"source":"deployer"}},
      {"action":"notify_discord","params":{"channel":"1487584901678104698"}}
    ]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'code_review' AND to_status = 'approved';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"auditor"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'approved' AND to_status = 'released';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"auditor"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'product_review' AND to_status = 'completed';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":null}}]'::jsonb
WHERE issue_type = 'bug' AND to_status = 'closed';

-- OPS -----------------------------------------------------------------------
UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['sprint','assignee','reviewer','owner','priority','severity']),
    post_functions = '[{"action":"set_assignee","params":{"source":"owner"}}]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'backlog' AND to_status = 'open';

UPDATE workflow_transitions
SET condition_role = 'assignee',
    validators = to_jsonb(ARRAY['implementation_notes']),
    post_functions = '[
      {"action":"set_assignee","params":{"source":"reviewer"}},
      {"action":"activate_code_review_agents","params":{}}
    ]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'in_progress' AND to_status = 'code_review';

UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['implementation_notes']),
    post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'in_progress' AND to_status = 'product_review';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"po"}}]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'in_progress' AND to_status = 'backlog';

UPDATE workflow_transitions
SET condition_role = 'tester_or_designer',
    validators = to_jsonb(ARRAY['dual_review_passed']),
    post_functions = '[{"action":"set_assignee","params":{"source":"deployer"}}]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'code_review' AND to_status = 'approved';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":"auditor"}}]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'approved' AND to_status = 'released';

UPDATE workflow_transitions
SET validators = to_jsonb(ARRAY['reviewer_notes']),
    post_functions = '[
      {"action":"set_assignee","params":{"source":"auditor"}},
      {"action":"notify_discord","params":{"channel":"1487584901678104698"}}
    ]'::jsonb
WHERE issue_type = 'ops' AND from_status = 'product_review' AND to_status = 'completed';

UPDATE workflow_transitions
SET post_functions = '[{"action":"set_assignee","params":{"source":null}}]'::jsonb
WHERE issue_type = 'ops' AND to_status = 'closed';
