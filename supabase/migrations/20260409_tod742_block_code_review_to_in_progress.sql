-- TOD-742: Delete code_review → in_progress for ALL issue types
-- The original dual_review_gate migration only removed this for 'task'.
-- Review failure must always route to 'open', never 'in_progress'.

DELETE FROM workflow_transitions
WHERE from_status = 'code_review' AND to_status = 'in_progress';
