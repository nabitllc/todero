-- TOD-621: Remove in_review and blocked from valid statuses
-- Remap any remaining issues with these statuses

UPDATE public.issues SET status = 'code_review' WHERE status = 'in_review';
UPDATE public.issues SET status = 'open', is_blocked = true WHERE status = 'blocked';
UPDATE public.issues SET status = 'completed' WHERE status = 'done';

-- Update per-type constraints
ALTER TABLE public.issues DROP CONSTRAINT IF EXISTS chk_per_type_valid_status;
ALTER TABLE public.issues ADD CONSTRAINT chk_per_type_valid_status CHECK (
  (type IN ('task','bug','feature','ops','research')
   AND status IN ('backlog','defined','open','in_progress','code_review','product_review','approved','released','completed','closed'))
  OR
  (type = 'epic'
   AND status IN ('backlog','draft','open','active','in_progress','completed','closed'))
  OR type IS NULL OR status IS NULL
);
