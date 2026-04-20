-- Add notify_discord (#3-signoff) to bug: product_review→completed.
-- task and ops already have this entry; bug was missed.

UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'::jsonb
WHERE issue_type = 'bug' AND from_status = 'product_review' AND to_status = 'completed'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1487584901678104698"}}]'::jsonb);
