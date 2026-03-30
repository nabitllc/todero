-- MC-361: Per-type valid status constraints
ALTER TABLE issues DROP CONSTRAINT IF EXISTS chk_per_type_valid_status;

ALTER TABLE issues ADD CONSTRAINT chk_per_type_valid_status CHECK (
  (type = 'task'     AND status IN ('backlog', 'open', 'in_progress', 'in_review', 'done', 'cancelled', 'blocked')) OR
  (type = 'bug'      AND status IN ('backlog', 'open', 'in_progress', 'in_review', 'done', 'cancelled', 'blocked')) OR
  (type = 'feature'  AND status IN ('backlog', 'open', 'in_progress', 'in_review', 'done', 'cancelled', 'blocked')) OR
  (type = 'epic'     AND status IN ('draft', 'active', 'completed', 'backlog', 'cancelled')) OR
  (type = 'ops'      AND status IN ('backlog', 'open', 'in_progress', 'done', 'cancelled', 'blocked')) OR
  (type = 'research' AND status IN ('backlog', 'open', 'in_progress', 'done', 'cancelled', 'blocked')) OR
  type IS NULL OR status IS NULL
);
