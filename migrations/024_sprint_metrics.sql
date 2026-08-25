-- Migration: 016_sprint_metrics
-- Creates sprint_metrics table for per-sprint velocity and cycle time reporting.
-- Populated by Sprint Close automation; queryable via GET /api/sprint-metrics.
--
-- NOTE (schema-migrations piece): sprint_id was declared `text` while
-- sprints.id (migrations/000_baseline_schema.sql — no other migration in this
-- directory ever created `sprints`) is `uuid`, so the FK below could not be
-- implemented on a fresh database. No app code references sprint_metrics or
-- sprint_id (grepped app/ and lib/ — nothing), so there is no persisted data
-- or call site whose type this changes; corrected to `uuid` to match the
-- table it references.

CREATE TABLE IF NOT EXISTS sprint_metrics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id            uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  project              text NOT NULL,
  issues_closed        integer NOT NULL DEFAULT 0,
  issues_rolled_over   integer NOT NULL DEFAULT 0,
  avg_cycle_time_hours float,
  rejection_rate       float,
  throughput_per_day   float,
  top_agents           jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sprint_metrics_sprint_id_idx ON sprint_metrics(sprint_id);
CREATE INDEX IF NOT EXISTS sprint_metrics_project_idx   ON sprint_metrics(project);
