-- MC-361: Per-type valid status constraints aligned with the current lifecycle
ALTER TABLE issues DROP CONSTRAINT IF EXISTS chk_per_type_valid_status;

ALTER TABLE issues ADD CONSTRAINT chk_per_type_valid_status CHECK (
  (type = 'task'     AND status IN ('backlog', 'defined', 'refined', 'open', 'in_progress', 'in_review', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked')) OR
  (type = 'bug'      AND status IN ('backlog', 'defined', 'refined', 'open', 'in_progress', 'in_review', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked')) OR
  (type = 'feature'  AND status IN ('backlog', 'defined', 'open', 'in_progress', 'in_review', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked')) OR
  (type = 'epic'     AND status IN ('backlog', 'draft', 'active', 'completed', 'closed')) OR
  (type = 'ops'      AND status IN ('backlog', 'defined', 'refined', 'open', 'in_progress', 'in_review', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked')) OR
  (type = 'research' AND status IN ('backlog', 'defined', 'refined', 'open', 'in_progress', 'in_review', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked')) OR
  type IS NULL OR status IS NULL
);
