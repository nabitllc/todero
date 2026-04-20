-- Add notify_discord (#1-queue) to rejection back-to-open transitions
-- code_review→open, product_review→open, approved→open
-- These transitions already have notify_rejection (→#2-rejected) which also
-- fans out to #1-queue in code, but this makes the queue notification explicit.

-- code_review → open
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb
WHERE from_status = 'code_review' AND to_status = 'open'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb);

-- product_review → open
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb
WHERE from_status = 'product_review' AND to_status = 'open'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb);

-- approved → open (un-approved, needs rework)
UPDATE workflow_transitions
SET post_functions = post_functions || '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb
WHERE from_status = 'approved' AND to_status = 'open'
  AND NOT (post_functions @> '[{"action":"notify_discord","params":{"channel":"1494440278524694608"}}]'::jsonb);
