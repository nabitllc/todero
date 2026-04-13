-- TOD-939: agent_cost_log table for per-completion cost events
-- Best-effort instrumentation — INSERT failures must not block agent completion

CREATE TABLE IF NOT EXISTS agent_cost_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project text NOT NULL,
  agent text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  token_count integer NOT NULL DEFAULT 0,
  task_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for dashboard queries (cost by agent, cost by project, cost by date)
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_agent ON agent_cost_log(agent);
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_project ON agent_cost_log(project);
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_date ON agent_cost_log(date);
