-- Semantic release records — one per merged PR.
-- Replaces release-notes.py polling approach.

CREATE TABLE IF NOT EXISTS releases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL,
  pr_number   INTEGER,
  pr_url      TEXT,
  commit_sha  TEXT,
  repo        TEXT NOT NULL DEFAULT 'nabitllc/todero',
  issue_keys  TEXT[]  NOT NULL DEFAULT '{}',
  issue_ids   UUID[]  NOT NULL DEFAULT '{}',
  groups      JSONB   NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS releases_version_idx ON releases (version);
CREATE INDEX IF NOT EXISTS releases_created_at_idx    ON releases (created_at DESC);
CREATE INDEX IF NOT EXISTS releases_pr_number_idx     ON releases (pr_number);
