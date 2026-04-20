-- Add notify_discord (#4-done) to epic and feature backlog→closed transitions.
-- All other →closed transitions already have this entry.

-- epic: backlog → closed
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1489025078602760302"}}]'::jsonb
WHERE issue_type = 'epic' AND from_status = 'backlog' AND to_status = 'closed'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1489025078602760302"}}]'::jsonb);

-- feature: backlog → closed
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1489025078602760302"}}]'::jsonb
WHERE issue_type = 'feature' AND from_status = 'backlog' AND to_status = 'closed'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1489025078602760302"}}]'::jsonb);
