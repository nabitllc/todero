-- Add notify_discord (#2-in-progress) to draft→active and defined→underway transitions.
-- open→in_progress already has this entry.

UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440378928201768"}}]'::jsonb
WHERE from_status = 'draft' AND to_status = 'active'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440378928201768"}}]'::jsonb);

UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440378928201768"}}]'::jsonb
WHERE from_status = 'defined' AND to_status = 'underway'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440378928201768"}}]'::jsonb);
