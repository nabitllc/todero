-- Phase 1: "defined" → "refined" for task/bug/ops/research
-- Phase 2: "completed" → "wrapped" for epic
-- Phase 3: Feature workflow restructure

-- NOTE: This migration must be run on Supabase Dashboard SQL editor
-- because we don't have direct psql access.

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: defined → refined (task/bug/ops/research)
-- ═══════════════════════════════════════════════════════════════════

-- Drop the existing per-type CHECK constraint
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_per_type;

-- Re-create with "refined" for task/bug/ops/research (features/epics keep "defined")
ALTER TABLE issues ADD CONSTRAINT issues_status_per_type CHECK (
  CASE type
    WHEN 'task' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'bug' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'ops' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'research' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'feature' THEN status IN ('backlog','defined','open','in_progress','code_review','product_review','approved','released','completed','closed')
    WHEN 'epic' THEN status IN ('backlog','draft','active','completed','closed')
    ELSE true
  END
);

-- Migrate existing issues
UPDATE issues SET status = 'refined' WHERE type IN ('task','bug','ops','research') AND status = 'defined';

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2: completed → wrapped (epic only)
-- ═══════════════════════════════════════════════════════════════════

-- Drop and recreate with "wrapped" for epics
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_per_type;

ALTER TABLE issues ADD CONSTRAINT issues_status_per_type CHECK (
  CASE type
    WHEN 'task' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'bug' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'ops' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'research' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'feature' THEN status IN ('backlog','defined','open','in_progress','code_review','product_review','approved','released','completed','closed')
    WHEN 'epic' THEN status IN ('backlog','draft','active','wrapped','closed')
    ELSE true
  END
);

UPDATE issues SET status = 'wrapped' WHERE type = 'epic' AND status = 'completed';

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 3: Feature workflow restructure
-- "in_progress" → "underway", "product_review" → "feature_review"
-- Remove "open" and "completed" for features
-- ═══════════════════════════════════════════════════════════════════

-- Migrate feature issues first
UPDATE issues SET status = 'underway' WHERE type = 'feature' AND status = 'in_progress';
UPDATE issues SET status = 'feature_review' WHERE type = 'feature' AND status = 'product_review';
UPDATE issues SET status = 'defined' WHERE type = 'feature' AND status = 'open';
UPDATE issues SET status = 'closed' WHERE type = 'feature' AND status = 'completed';

-- Final constraint with all renames
ALTER TABLE issues DROP CONSTRAINT IF EXISTS issues_status_per_type;

ALTER TABLE issues ADD CONSTRAINT issues_status_per_type CHECK (
  CASE type
    WHEN 'task' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'bug' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'ops' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'research' THEN status IN ('backlog','refined','open','in_progress','code_review','product_review','approved','released','closed')
    WHEN 'feature' THEN status IN ('backlog','defined','underway','code_review','feature_review','approved','released','closed')
    WHEN 'epic' THEN status IN ('backlog','draft','active','wrapped','closed')
    ELSE true
  END
);
