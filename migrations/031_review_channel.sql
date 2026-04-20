-- Add notify_discord (#2-review) to defined→underway and draft→active transitions.
-- in_progress→code_review and in_progress→product_review already have this entry.

-- feature: defined → underway
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440461404733500"}}]'::jsonb
WHERE from_status = 'defined' AND to_status = 'underway'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440461404733500"}}]'::jsonb);

-- epic: draft → active
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440461404733500"}}]'::jsonb
WHERE from_status = 'draft' AND to_status = 'active'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440461404733500"}}]'::jsonb);
