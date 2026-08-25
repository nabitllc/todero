-- Deploy history log — one row per deploy attempt (INF-209 / INF-210).
-- Columns match what app/api/deploy-history/route.ts and lib/deploy-history.ts
-- actually select/insert/update — read from the query code, not guessed.

CREATE TABLE IF NOT EXISTS deploy_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project         TEXT        NOT NULL,
  branch          TEXT        NOT NULL,
  commit_sha      TEXT,
  commit_message  TEXT,
  status          TEXT        NOT NULL CHECK (status IN ('pending', 'building', 'ready', 'error', 'canceled')),
  source          TEXT        NOT NULL CHECK (source IN ('vercel', 'manual', 'github_action')),
  url             TEXT,
  triggered_by    TEXT,
  duration_ms     INTEGER,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS deploy_history_project_idx    ON deploy_history (project);
CREATE INDEX IF NOT EXISTS deploy_history_status_idx     ON deploy_history (status);
CREATE INDEX IF NOT EXISTS deploy_history_created_at_idx ON deploy_history (created_at DESC);
