-- TOD-1495: Add 'refined' to valid statuses for task/bug/feature/ops/research
-- The workflow_transitions table uses backlog→refined as the PO grooming step,
-- but the per-type constraint added in tod621 omitted 'refined'. This migration
-- re-adds it so PATCH status=refined no longer violates the DB constraint.

ALTER TABLE public.issues DROP CONSTRAINT IF EXISTS chk_per_type_valid_status;
ALTER TABLE public.issues ADD CONSTRAINT chk_per_type_valid_status CHECK (
  (type IN ('task','bug','feature','ops','research')
   AND status IN ('backlog','defined','refined','open','in_progress','code_review','product_review','approved','released','completed','closed'))
  OR
  (type = 'epic'
   AND status IN ('backlog','draft','open','active','in_progress','completed','closed'))
  OR type IS NULL OR status IS NULL
);

-- Also fix the issue_status_category function to return 'Planned' for 'refined'
CREATE OR REPLACE FUNCTION public.issue_status_category(issue_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE issue_status
    WHEN 'backlog'         THEN 'Planned'
    WHEN 'defined'         THEN 'Planned'
    WHEN 'refined'         THEN 'Planned'
    WHEN 'open'            THEN 'Planned'
    WHEN 'in_progress'     THEN 'Ongoing'
    WHEN 'code_review'     THEN 'Ongoing'
    WHEN 'product_review'  THEN 'Ongoing'
    WHEN 'approved'        THEN 'Ongoing'
    WHEN 'released'        THEN 'SignOff'
    WHEN 'completed'       THEN 'SignOff'
    WHEN 'closed'          THEN 'Done'
    ELSE NULL
  END
$$;

-- Backfill status_category for any existing refined issues that have null category
UPDATE public.issues
SET status_category = 'Planned'
WHERE status = 'refined' AND (status_category IS NULL OR status_category != 'Planned');
