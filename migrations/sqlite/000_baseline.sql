-- ── SQLite baseline — the zero-account database ──────────────────────────────
--
-- `npm run setup` applies this file when a clone has no Supabase project and no
-- DATABASE_URL, so a stranger reaches a working board without opening an
-- account anywhere. It is the SQLite dialect of the SAME schema the Postgres
-- path reaches after `migrations/*.sql` have all applied — not a reduced
-- "demo" subset: every table, index, CHECK constraint and foreign key the
-- Postgres install ends up with is here, so the two hosts answer the same
-- queries the same way.
--
-- HOW IT WAS PRODUCED (and how to reproduce it after adding a migration)
--   The 38 files in migrations/ were applied in order to an in-process
--   Postgres, and the resulting catalogue was read back and re-emitted in
--   SQLite dialect. This file is therefore a translation of the real end
--   state, not a hand-copy of 000_baseline_schema.sql — which is why the
--   columns later migrations ADD (commit_sha, test_tier, is_blocked,
--   status_category, heartbeat_at, …) and the tables they create
--   (connections, deploy_history, agent_heartbeats, workspace_members,
--   activity_events, inbox, notifications, releases, token_ledger, …) are all
--   present. Add a migration to migrations/, then re-translate.
--
-- DIALECT DIFFERENCES, all handled here rather than at query time
--   uuid          -> TEXT, with a UUIDv4-shaped randomblob() default, since
--                    SQLite has no gen_random_uuid().
--   timestamptz   -> TEXT holding an ISO-8601 UTC string, the exact shape the
--                    hosted adapter returns, so `new Date(row.created_at)`
--                    parses identically on both.
--   jsonb, text[] -> JSON_TEXT (TEXT affinity) holding JSON. lib/db/sqlite-adapter.ts reads each
--                    table's declared column types once and JSON.parses these
--                    on the way out / JSON.stringifies on the way in, so app
--                    code sees objects and arrays exactly as it does on
--                    Postgres.
--   boolean       -> BOOLEAN affinity (0/1 on disk). The adapter decodes those
--                    columns back to real true/false for the same reason.
--   = ANY (ARRAY[…]) in CHECK constraints -> IN (…).
--   The two Postgres functions the app calls through the seam's rpc() —
--   next_issue_number() and pg_database_size_bytes() — have no DDL here;
--   lib/db/sqlite-adapter.ts implements both natively.
--
-- Foreign keys are declared and the adapter opens the file with
-- `PRAGMA foreign_keys = ON`, so referential integrity behaves as it does on
-- Postgres instead of being silently ignored (SQLite's default).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  name       TEXT      NOT NULL,
  type       TEXT,
  owner      TEXT,
  status     TEXT      NOT NULL DEFAULT 'active',
  created_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  business_id TEXT,
  name        TEXT      NOT NULL,
  description TEXT,
  repo_url    TEXT,
  status      TEXT      NOT NULL DEFAULT 'active',
  created_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS projects_business_id_idx ON projects (business_id);

CREATE TABLE IF NOT EXISTS sprints (
  id            TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  business_id   TEXT,
  name          TEXT      NOT NULL,
  project       TEXT,
  goal          TEXT,
  start_date    TEXT,
  end_date      TEXT,
  status        TEXT      NOT NULL DEFAULT 'active',
  sprint_number INTEGER,
  created_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sprints_business_id_idx ON sprints (business_id);
CREATE INDEX IF NOT EXISTS sprints_project_status_idx ON sprints (project, status);

CREATE TABLE IF NOT EXISTS issues (
  id                    TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  task_key              TEXT,
  task_number           INTEGER,
  title                 TEXT      NOT NULL,
  description           TEXT,
  status                TEXT      NOT NULL DEFAULT 'backlog',
  type                  TEXT,
  priority              TEXT,
  severity              TEXT,
  assignee              TEXT,
  owner                 TEXT,
  reviewer              TEXT,
  reviewed_by           TEXT,
  deployer              TEXT,
  auditor               TEXT,
  sprint                TEXT,
  project               TEXT,
  business_id           TEXT,
  due_date              TEXT,
  parent_id             TEXT,
  blocked_by            TEXT,
  resolution_type       TEXT,
  rejection_count       INTEGER   NOT NULL DEFAULT 0,
  last_rejected_at      TEXT,
  last_rejection_reason TEXT,
  acceptance_criteria   TEXT,
  feature_branch        TEXT,
  pr_url                TEXT,
  transitioned_by       TEXT,
  created_at            TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  commit_sha            TEXT,
  implementation_notes  TEXT,
  reviewer_notes        TEXT,
  started_at            TEXT,
  submitted_at          TEXT,
  completed_at          TEXT,
  worked_by             TEXT,
  regression_test       TEXT,
  tester_status         TEXT      DEFAULT 'pending',
  tester_notes          TEXT,
  tested_by             TEXT,
  tester_reviewed_at    TEXT,
  designer_status       TEXT      DEFAULT 'pending',
  designer_notes        TEXT,
  designed_by           TEXT,
  designer_reviewed_at  TEXT,
  status_category       TEXT,
  is_blocked            BOOLEAN   NOT NULL DEFAULT 0,
  fail_count            INTEGER   NOT NULL DEFAULT 0,
  closing_notes         TEXT,
  heartbeat_at          TEXT,
  test_tier             TEXT,
  deployer_status       TEXT,
  deployer_notes        TEXT,
  UNIQUE (task_key),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES issues(id) ON DELETE SET NULL,
  CHECK ((NOT ((status = 'backlog') AND (sprint IS NOT NULL)))),
  CHECK ((deployer_status IN ('ready', 'failed'))),
  CHECK ((test_tier IN ('smoke', 'integration', 'e2e'))),
  CHECK (((status NOT IN ('open', 'in_progress', 'in_review')) OR (sprint IS NOT NULL))),
  CHECK (((resolution_type IS NULL) OR (resolution_type IN ('code_change', 'config_change', 'database_change', 'research_completed', 'documentation', 'duplicate', 'by_design', 'expected_behavior', 'wont_fix', 'not_reproducible', 'deferred', 'no_change_required', 'no_action', 'completed', 'cancelled'))))
);
CREATE INDEX IF NOT EXISTS idx_issues_heartbeat_at ON issues (heartbeat_at) WHERE (status = 'in_progress');
CREATE INDEX IF NOT EXISTS issues_assignee_idx ON issues (assignee);
CREATE INDEX IF NOT EXISTS issues_blocked_idx ON issues (is_blocked, status) WHERE (is_blocked = true);
CREATE INDEX IF NOT EXISTS issues_business_id_idx ON issues (business_id);
CREATE INDEX IF NOT EXISTS issues_parent_id_idx ON issues (parent_id);
CREATE INDEX IF NOT EXISTS issues_project_idx ON issues (project);
CREATE INDEX IF NOT EXISTS issues_status_idx ON issues (status);

CREATE TABLE IF NOT EXISTS agents (
  id              TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  business_id     TEXT,
  name            TEXT      NOT NULL,
  adapter         TEXT      NOT NULL DEFAULT 'claude-code',
  model           TEXT,
  api_key_enc     TEXT,
  heartbeat_every TEXT,
  description     TEXT,
  created_at      TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agents_business_id_idx ON agents (business_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id           TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id     TEXT      NOT NULL,
  task_id      TEXT,
  task_title   TEXT,
  status       TEXT      NOT NULL DEFAULT 'running',
  started_at   TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  finished_at  TEXT,
  tokens_used  INTEGER,
  cost_usd     REAL,
  output       TEXT,
  error        TEXT,
  created_at   TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (task_id) REFERENCES issues(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx ON agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_started_at_idx ON agent_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_task_id_idx ON agent_runs (task_id);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id            TEXT      PRIMARY KEY,
  title         TEXT,
  model         TEXT,
  agent_id      TEXT,
  project       TEXT,
  pinned        BOOLEAN   NOT NULL DEFAULT 0,
  system_prompt TEXT,
  forked_from   TEXT,
  created_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT      PRIMARY KEY,
  conversation_id TEXT,
  role            TEXT      NOT NULL,
  content         TEXT,
  model           TEXT,
  image_url       TEXT,
  bookmarked      BOOLEAN   NOT NULL DEFAULT 0,
  created_at      TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_id_idx ON chat_messages (conversation_id);

CREATE TABLE IF NOT EXISTS agent_documents (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id   TEXT      NOT NULL,
  doc_type   TEXT      NOT NULL,
  slug       TEXT      NOT NULL,
  content    TEXT      NOT NULL DEFAULT '',
  updated_at TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  UNIQUE (agent_id, doc_type, slug),
  CHECK ((doc_type IN ('soul', 'agents', 'skill', 'heartbeat')))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id              TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  name            TEXT      NOT NULL,
  slug            TEXT      NOT NULL,
  logo_url        TEXT,
  billing_contact TEXT,
  created_at      TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS hubs (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  name       TEXT      NOT NULL,
  slug       TEXT      NOT NULL,
  owner_id   TEXT,
  created_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_id, slug)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  issue_id   TEXT      NOT NULL,
  issue_key  TEXT,
  event_type TEXT      NOT NULL,
  actor      TEXT,
  actor_type TEXT,
  metadata   JSON_TEXT,
  created_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS activity_events_created_at_idx ON activity_events (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_event_type_idx ON activity_events (event_type);
CREATE INDEX IF NOT EXISTS activity_events_issue_id_idx ON activity_events (issue_id);

CREATE TABLE IF NOT EXISTS agent_cost_log (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project     TEXT      NOT NULL,
  agent       TEXT      NOT NULL,
  date        TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
  cost_usd    REAL      NOT NULL DEFAULT 0,
  token_count INTEGER   NOT NULL DEFAULT 0,
  task_key    TEXT,
  created_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_agent ON agent_cost_log (agent);
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_date ON agent_cost_log (date);
CREATE INDEX IF NOT EXISTS idx_agent_cost_log_project ON agent_cost_log (project);

CREATE TABLE IF NOT EXISTS agent_document_history (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  document_id TEXT,
  content     TEXT      NOT NULL,
  changed_by  TEXT,
  changed_at  TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (document_id) REFERENCES agent_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_heartbeats (
  agent_id  TEXT      PRIMARY KEY,
  last_seen TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  pid       INTEGER,
  host      TEXT,
  task      TEXT
);
CREATE INDEX IF NOT EXISTS agent_heartbeats_last_seen_idx ON agent_heartbeats (last_seen DESC);

CREATE TABLE IF NOT EXISTS agent_memory (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id    TEXT      NOT NULL,
  memory_type TEXT      NOT NULL,
  date_key    TEXT,
  content     TEXT      NOT NULL DEFAULT '',
  updated_at  TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (agent_id, memory_type, date_key),
  CHECK ((memory_type IN ('daily', 'long_term', 'self_improving', 'corrections', 'session_state')))
);

CREATE TABLE IF NOT EXISTS agent_memory_files (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id    TEXT      NOT NULL,
  memory_type TEXT      NOT NULL,
  date_key    TEXT,
  content     TEXT      NOT NULL DEFAULT '',
  updated_at  TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (agent_id, memory_type, date_key)
);

CREATE TABLE IF NOT EXISTS connections (
  id              TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  workspace_id    TEXT      NOT NULL,
  type            TEXT      NOT NULL,
  encrypted_value TEXT      NOT NULL,
  metadata        JSON_TEXT NOT NULL DEFAULT '{}',
  status          TEXT      NOT NULL DEFAULT 'active',
  created_at      TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status IN ('active', 'inactive', 'error'))),
  CHECK ((type IN ('github', 'openai', 'anthropic', 'openrouter', 'webhook')))
);
CREATE INDEX IF NOT EXISTS connections_status_idx ON connections (status);
CREATE INDEX IF NOT EXISTS connections_type_idx ON connections (type);
CREATE INDEX IF NOT EXISTS connections_workspace_idx ON connections (workspace_id);

CREATE TABLE IF NOT EXISTS deploy_history (
  id             TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project        TEXT      NOT NULL,
  branch         TEXT      NOT NULL,
  commit_sha     TEXT,
  commit_message TEXT,
  status         TEXT      NOT NULL,
  source         TEXT      NOT NULL,
  url            TEXT,
  triggered_by   TEXT,
  duration_ms    INTEGER,
  error_message  TEXT,
  created_at     TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at    TEXT,
  CHECK ((source IN ('vercel', 'manual', 'github_action'))),
  CHECK ((status IN ('pending', 'building', 'ready', 'error', 'canceled')))
);
CREATE INDEX IF NOT EXISTS deploy_history_created_at_idx ON deploy_history (created_at DESC);
CREATE INDEX IF NOT EXISTS deploy_history_project_idx ON deploy_history (project);
CREATE INDEX IF NOT EXISTS deploy_history_status_idx ON deploy_history (status);

CREATE TABLE IF NOT EXISTS hub_members (
  id        TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  hub_id    TEXT      NOT NULL,
  user_id   TEXT,
  role      TEXT      NOT NULL DEFAULT 'member',
  joined_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (hub_id, user_id),
  FOREIGN KEY (hub_id) REFERENCES hubs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inbox (
  id            TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent         TEXT      NOT NULL,
  type          TEXT      NOT NULL,
  context       JSON_TEXT,
  status        TEXT      NOT NULL DEFAULT 'pending',
  created_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT,
  resolved_at   TEXT,
  resolved_by   TEXT,
  response_data JSON_TEXT,
  issue_id      TEXT,
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
  CHECK ((status IN ('pending', 'approved', 'denied', 'timeout', 'explained')))
);
CREATE INDEX IF NOT EXISTS inbox_status_created_idx ON inbox (status, created_at DESC) WHERE (status = 'pending');

CREATE TABLE IF NOT EXISTS issue_sequences (
  prefix      TEXT      PRIMARY KEY,
  next_number INTEGER   NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS milestones (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project     TEXT      NOT NULL,
  name        TEXT      NOT NULL,
  description TEXT,
  status      TEXT      NOT NULL DEFAULT 'planned',
  due_date    TEXT,
  created_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS milestones_project_idx ON milestones (project);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  type       TEXT      NOT NULL,
  title      TEXT      NOT NULL,
  body       TEXT,
  issue_key  TEXT,
  issue_id   TEXT,
  actor      TEXT,
  read       BOOLEAN   NOT NULL DEFAULT 0,
  created_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE SET NULL,
  CHECK ((type IN ('status_change', 'agent_completion', 'deploy')))
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read_created ON notifications (read, created_at DESC);

CREATE TABLE IF NOT EXISTS quick_actions (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  label       TEXT      NOT NULL,
  icon        TEXT,
  action_type TEXT      NOT NULL,
  payload     JSON_TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER   NOT NULL DEFAULT 99,
  enabled     BOOLEAN   NOT NULL DEFAULT 1,
  created_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS quick_actions_enabled_sort_idx ON quick_actions (enabled, sort_order);

CREATE TABLE IF NOT EXISTS releases (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  version    TEXT      NOT NULL,
  pr_number  INTEGER,
  pr_url     TEXT,
  commit_sha TEXT,
  repo       TEXT      NOT NULL DEFAULT 'nabitllc/todero',
  issue_keys JSON_TEXT NOT NULL DEFAULT '[]',
  issue_ids  JSON_TEXT NOT NULL DEFAULT '[]',
  groups     JSON_TEXT NOT NULL DEFAULT '{}',
  created_at TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS releases_created_at_idx ON releases (created_at DESC);
CREATE INDEX IF NOT EXISTS releases_pr_number_idx ON releases (pr_number);
CREATE UNIQUE INDEX IF NOT EXISTS releases_version_idx ON releases (version);

CREATE TABLE IF NOT EXISTS role_permissions (
  id         TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  role       TEXT      NOT NULL,
  permission TEXT      NOT NULL,
  UNIQUE (role, permission)
);

CREATE TABLE IF NOT EXISTS sprint_metrics (
  id                   TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  sprint_id            TEXT      NOT NULL,
  project              TEXT      NOT NULL,
  issues_closed        INTEGER   NOT NULL DEFAULT 0,
  issues_rolled_over   INTEGER   NOT NULL DEFAULT 0,
  avg_cycle_time_hours REAL,
  rejection_rate       REAL,
  throughput_per_day   REAL,
  top_agents           JSON_TEXT,
  created_at           TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sprint_metrics_project_idx ON sprint_metrics (project);
CREATE INDEX IF NOT EXISTS sprint_metrics_sprint_id_idx ON sprint_metrics (sprint_id);

CREATE TABLE IF NOT EXISTS token_ledger (
  id            TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  agent_id      TEXT      NOT NULL,
  task_id       TEXT,
  task_key      TEXT,
  runtime       TEXT      NOT NULL,
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  total_tokens  INTEGER,
  cost_usd      REAL,
  prompt_bytes  INTEGER,
  log_file      TEXT,
  spawned_at    TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at  TEXT,
  status        TEXT      NOT NULL DEFAULT 'spawned',
  metadata      JSON_TEXT,
  CHECK ((status IN ('spawned', 'completed', 'failed', 'killed')))
);
CREATE INDEX IF NOT EXISTS token_ledger_agent_spawned_idx ON token_ledger (agent_id, spawned_at DESC);
CREATE INDEX IF NOT EXISTS token_ledger_runtime_idx ON token_ledger (runtime, spawned_at DESC);
CREATE INDEX IF NOT EXISTS token_ledger_task_idx ON token_ledger (task_key);

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id             TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  issue_type     TEXT      NOT NULL,
  from_status    TEXT      NOT NULL,
  to_status      TEXT      NOT NULL,
  condition_role TEXT,
  validators     JSON_TEXT,
  post_functions JSON_TEXT,
  created_at     TEXT      DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_transitions_type_from_to ON workflow_transitions (issue_type, from_status, to_status);

CREATE TABLE IF NOT EXISTS workspace_members (
  id          TEXT      PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  identity    TEXT      NOT NULL,
  role        TEXT      NOT NULL DEFAULT 'member',
  assigned_by TEXT,
  created_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT      NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (identity)
);

-- ── seed: workflow_transitions ─────────────────────────────────────────────
-- Same rows migrations/020,023,028 INSERT on Postgres, carried over verbatim.
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('bug', 'defined', 'open', 'po_or_main', '["acceptance_criteria","sprint","priority","severity","assignee","parent_id","reviewer","owner","environment"]', '[{"action":"set_assignee","params":{"source":"owner"}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('bug', 'open', 'code_review', 'assignee', '["implementation_notes","regression_test","ref_required"]', '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('feature', 'defined', 'open', 'po_or_main', '["acceptance_criteria","sprint","priority","assignee","reviewer","owner"]', '[{"action":"set_assignee","params":{"source":"owner"}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('ops', 'defined', 'open', 'po_or_main', '["sprint","assignee","reviewer","owner","priority","severity"]', '[{"action":"set_assignee","params":{"source":"owner"}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('research', 'defined', 'open', 'po_or_main', '["acceptance_criteria","sprint","priority","assignee"]', '[{"action":"set_assignee","params":{"source":"assignee"}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('task', 'defined', 'open', 'po_or_main', '["acceptance_criteria","sprint","priority","assignee","parent_id","reviewer","owner","severity"]', '[{"action":"set_assignee","params":{"source":"owner"}}]');
INSERT OR IGNORE INTO workflow_transitions (issue_type, from_status, to_status, condition_role, validators, post_functions)
  VALUES ('task', 'open', 'code_review', 'assignee', '["implementation_notes","regression_test","ref_required"]', '[{"action":"set_assignee","params":{"from_field":"reviewer"}},{"action":"activate_code_review_agents","params":{}}]');

INSERT OR IGNORE INTO workspaces (name, slug) VALUES ('Todero', 'todero');

-- ── triggers ────────────────────────────────────────────────────────────────
-- The four triggers the Postgres schema ends up with, re-expressed in SQLite.
-- Postgres BEFORE triggers assign to NEW; SQLite BEFORE triggers cannot, so
-- the two that derive a column are AFTER triggers that write the row back.
-- SQLite has recursive_triggers OFF by default, and each one is additionally
-- guarded so it cannot re-fire on the write it just made.

-- issues.status_category — migrations/004_issue_status_category_canonical.sql
-- (issue_status_category() inlined; SQLite has no user-defined SQL functions).
CREATE TRIGGER IF NOT EXISTS issues_sync_status_category_ins
AFTER INSERT ON issues
BEGIN
  UPDATE issues SET status_category = CASE NEW.status
    WHEN 'backlog'        THEN 'Planned'
    WHEN 'defined'        THEN 'Planned'
    WHEN 'refined'        THEN 'Planned'
    WHEN 'open'           THEN 'Planned'
    WHEN 'in_progress'    THEN 'Ongoing'
    WHEN 'code_review'    THEN 'Ongoing'
    WHEN 'product_review' THEN 'Ongoing'
    WHEN 'approved'       THEN 'Ongoing'
    WHEN 'released'       THEN 'SignOff'
    WHEN 'completed'      THEN 'SignOff'
    WHEN 'closed'         THEN 'Done'
    ELSE NULL
  END WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS issues_sync_status_category_upd
AFTER UPDATE OF status ON issues
BEGIN
  UPDATE issues SET status_category = CASE NEW.status
    WHEN 'backlog'        THEN 'Planned'
    WHEN 'defined'        THEN 'Planned'
    WHEN 'refined'        THEN 'Planned'
    WHEN 'open'           THEN 'Planned'
    WHEN 'in_progress'    THEN 'Ongoing'
    WHEN 'code_review'    THEN 'Ongoing'
    WHEN 'product_review' THEN 'Ongoing'
    WHEN 'approved'       THEN 'Ongoing'
    WHEN 'released'       THEN 'SignOff'
    WHEN 'completed'      THEN 'SignOff'
    WHEN 'closed'         THEN 'Done'
    ELSE NULL
  END WHERE id = NEW.id;
END;

-- agent_documents history snapshot — migrations/016_agent_documents.sql
CREATE TRIGGER IF NOT EXISTS agent_doc_history
BEFORE UPDATE ON agent_documents
BEGIN
  INSERT INTO agent_document_history (document_id, content, changed_by, changed_at)
  VALUES (OLD.id, OLD.content, OLD.updated_by, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- workspace_members.updated_at — migrations/013_workspace_roles.sql
CREATE TRIGGER IF NOT EXISTS trg_workspace_members_updated_at
AFTER UPDATE ON workspace_members
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE workspace_members SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.id;
END;

-- hubs.updated_at — migrations/019_hubs_and_hub_members.sql
CREATE TRIGGER IF NOT EXISTS trg_hubs_updated_at
AFTER UPDATE ON hubs
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE hubs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id;
END;

-- ── seed: role_permissions ────────────────────────────────────────────────
-- Mirrors ROLE_PERMISSIONS in lib/rbac-types.ts, which is the runtime source
-- of truth (lib/permission-check.ts checks it first). Seeded so /api/roles and
-- the roles UI show the real matrix on a fresh install instead of an empty
-- table, and so the table can still GRANT beyond the static matrix.
INSERT OR IGNORE INTO role_permissions (role, permission) VALUES
  -- owner
  ('owner', 'issues:read'),
  ('owner', 'issues:write'),
  ('owner', 'issues:delete'),
  ('owner', 'issues:admin'),
  ('owner', 'sprints:read'),
  ('owner', 'sprints:write'),
  ('owner', 'sprints:admin'),
  ('owner', 'agents:read'),
  ('owner', 'agents:write'),
  ('owner', 'agents:spawn'),
  ('owner', 'agents:admin'),
  ('owner', 'projects:read'),
  ('owner', 'projects:write'),
  ('owner', 'projects:admin'),
  ('owner', 'settings:read'),
  ('owner', 'settings:write'),
  ('owner', 'calendar:read'),
  ('owner', 'calendar:write'),
  ('owner', 'memory:read'),
  ('owner', 'memory:write'),
  ('owner', 'infra:read'),
  ('owner', 'infra:admin'),
  ('owner', 'roles:read'),
  ('owner', 'roles:admin'),
  -- member
  ('member', 'issues:read'),
  ('member', 'issues:write'),
  ('member', 'sprints:read'),
  ('member', 'sprints:write'),
  ('member', 'agents:read'),
  ('member', 'agents:write'),
  ('member', 'agents:spawn'),
  ('member', 'projects:read'),
  ('member', 'projects:write'),
  ('member', 'settings:read'),
  ('member', 'calendar:read'),
  ('member', 'calendar:write'),
  ('member', 'memory:read'),
  ('member', 'memory:write'),
  ('member', 'infra:read'),
  ('member', 'roles:read'),
  -- god
  ('god', 'issues:read'),
  ('god', 'issues:write'),
  ('god', 'issues:delete'),
  ('god', 'issues:admin'),
  ('god', 'sprints:read'),
  ('god', 'sprints:write'),
  ('god', 'sprints:admin'),
  ('god', 'agents:read'),
  ('god', 'agents:write'),
  ('god', 'agents:spawn'),
  ('god', 'agents:admin'),
  ('god', 'projects:read'),
  ('god', 'projects:write'),
  ('god', 'projects:admin'),
  ('god', 'settings:read'),
  ('god', 'settings:write'),
  ('god', 'calendar:read'),
  ('god', 'calendar:write'),
  ('god', 'memory:read'),
  ('god', 'memory:write'),
  ('god', 'infra:read'),
  ('god', 'infra:admin'),
  ('god', 'roles:read'),
  ('god', 'roles:admin'),
  -- admin
  ('admin', 'issues:read'),
  ('admin', 'issues:write'),
  ('admin', 'issues:delete'),
  ('admin', 'sprints:read'),
  ('admin', 'sprints:write'),
  ('admin', 'agents:read'),
  ('admin', 'agents:write'),
  ('admin', 'agents:spawn'),
  ('admin', 'projects:read'),
  ('admin', 'projects:write'),
  ('admin', 'settings:read'),
  ('admin', 'settings:write'),
  ('admin', 'calendar:read'),
  ('admin', 'calendar:write'),
  ('admin', 'memory:read'),
  ('admin', 'memory:write'),
  ('admin', 'infra:read'),
  -- viewer
  ('viewer', 'issues:read'),
  ('viewer', 'sprints:read'),
  ('viewer', 'agents:read'),
  ('viewer', 'projects:read'),
  ('viewer', 'settings:read'),
  ('viewer', 'calendar:read'),
  ('viewer', 'memory:read'),
  ('viewer', 'infra:read'),
  -- tron
  ('tron', 'issues:read'),
  ('tron', 'issues:write'),
  ('tron', 'sprints:read'),
  ('tron', 'agents:read'),
  ('tron', 'agents:spawn'),
  ('tron', 'projects:read'),
  ('tron', 'calendar:read'),
  ('tron', 'memory:read'),
  ('tron', 'memory:write'),
  -- defaultbot
  ('defaultbot', 'issues:read'),
  ('defaultbot', 'issues:write'),
  ('defaultbot', 'sprints:read'),
  ('defaultbot', 'agents:read'),
  ('defaultbot', 'projects:read'),
  ('defaultbot', 'memory:read');
