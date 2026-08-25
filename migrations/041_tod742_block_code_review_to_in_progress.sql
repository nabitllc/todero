-- TOD-742: Delete code_review → in_progress for ALL issue types
-- The original dual_review_gate migration only removed this for 'task'.
-- Review failure must always route to 'open', never 'in_progress'.
--
-- NOTE (boot-migrations piece): renumbered from 007 -> 041. It was filed as
-- 007 in the same commit as 007_dual_review_open_canonical.sql, colliding
-- with it. This file has no downstream dependents (nothing later re-adds a
-- code_review→in_progress transition), so it moved; the other 007 file
-- stayed at 007 because 029_queue_channel_rejections.sql appends to
-- post_functions on the same rows it sets and would be silently clobbered
-- if that one ran after 029 instead of before it.

DELETE FROM workflow_transitions
WHERE from_status = 'code_review' AND to_status = 'in_progress';
