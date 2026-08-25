-- 006: Notifications table for in-app notification bell (TOD-631)
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('status_change', 'agent_completion', 'deploy')),
  title text NOT NULL,
  body text,
  issue_key text,
  issue_id uuid REFERENCES issues(id) ON DELETE SET NULL,
  actor text,           -- who/what triggered it (agent name, system, etc.)
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_read_created ON notifications (read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);
