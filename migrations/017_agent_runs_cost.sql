-- Phase 2.2 (TOD-1514): Add cost tracking columns to agent_runs
-- Populated by run-agent/route.ts when session ends
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS tokens_used integer,
  ADD COLUMN IF NOT EXISTS cost_usd    numeric(10,6);
