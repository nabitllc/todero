-- 035_clear_assignee_on_refined.sql
-- Append set_assignee:null post_function to backlog→refined transitions
-- for task/bug/ops/research so the refined lane is empty-assignee by default.
-- queue-refill then sets assignee=lane.agent when promoting refined→open,
-- which self-heals stale assignees left over from earlier owner-field clobbers.

UPDATE workflow_transitions
SET post_functions = post_functions || jsonb_build_array(
  jsonb_build_object('action', 'set_assignee', 'params', jsonb_build_object('to', null))
)
WHERE from_status = 'backlog'
  AND to_status = 'refined'
  AND issue_type IN ('task', 'bug', 'ops', 'research')
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(post_functions) pf
    WHERE pf->>'action' = 'set_assignee'
  );
