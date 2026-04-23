-- Migration: 016_sprint_metrics
-- Creates sprint_metrics table for per-sprint velocity and cycle time reporting.
-- Populated by Sprint Close automation; queryable via GET /api/sprint-metrics.

CREATE TABLE IF NOT EXISTS sprint_metrics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id            text NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
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
