-- Baseline schema — the tables every later migration in this directory
-- assumes already exist (issues, agents, agent_runs, sprints, projects,
-- chat_conversations, chat_messages, businesses, milestones,
-- workflow_transitions, role_permissions, quick_actions).
--
-- Before this file, `npm run db:migrate` on a fresh database aborted on
-- 001_add_review_fields.sql with `relation "issues" does not exist` — every
-- migration from 001 onward is an ALTER TABLE / INSERT INTO against tables
-- nothing ever CREATEs. This file is that CREATE. It is deliberately named
-- 000_ so it sorts and applies first.
--
-- Columns come from the real call sites, not guesswork:
--   - `issues`: app/api/issues/route.ts SELECT_COLS (full column list, line
--     ~857), the POST insert body (line ~1187), and the missing-column
--     retry's own column list (line ~1857) — a defensive fallback the API
--     already carries for exactly the schema gap this file closes. Only
--     columns that NO migration in this directory later ADD COLUMNs are
--     declared here; every column a later migration adds via
--     `ADD COLUMN IF NOT EXISTS` (commit_sha, tester_status, deployer_status,
--     closing_notes, test_tier, heartbeat_at, is_blocked, fail_count, ...) is
--     deliberately left OUT of this file and created by that migration
--     instead, so its paired CHECK constraint still gets added too.
--   - `agents`: app/api/business-agents/route.ts and app/api/onboarding/route.ts
--   - `agent_runs`: app/api/run-agent/route.ts, lib/issues.ts logAgentRun(),
--     app/api/agents/route.ts, app/api/status/route.ts, app/api/office-stream/route.ts
--   - `sprints`: app/api/sprint-start/route.ts, app/api/sprint-close/route.ts,
--     app/api/onboarding/route.ts
--   - `projects`: app/api/projects/route.ts, app/api/sprint-start/route.ts
--   - `businesses`: app/api/businesses/route.ts, app/api/onboarding/route.ts
--   - `chat_conversations` / `chat_messages`: app/api/chat/conversations/route.ts,
--     app/api/chat/messages/route.ts, app/api/chat/route.ts, components/tabs/ChatTab.tsx
--     (client generates ids as `'chat-' + Date.now()` / `'msg-...'+Date.now()` —
--     plain strings, not UUIDs, so both `id` columns are TEXT, not UUID)
--   - `milestones`: app/api/milestones/route.ts
--   - `workflow_transitions`: verbatim shape of config/migrations/008_add_task_workflow.sql,
--     the companion repo's already-authoritative CREATE TABLE for this table,
--     plus app/api/issues/route.ts's two `.select('condition_role, validators, post_functions')`
--     call sites
--   - `role_permissions`: lib/rbac-types.ts RolePermission, lib/permission-check.ts,
--     lib/rbac-middleware.ts
--   - `quick_actions`: lib/quick-actions-constants.ts QuickAction type,
--     lib/quick-actions.ts listQuickActions()/upsertQuickAction()

-- ── businesses ──────────────────────────────────────────────────────────────
-- Referenced as the FK target of business_id on projects/sprints/agents/issues,
-- so it must exist first.
CREATE TABLE IF NOT EXISTS businesses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  type        TEXT,
  owner       TEXT,
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID        REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  repo_url    TEXT,
  status      TEXT        NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS projects_business_id_idx ON projects (business_id);

-- ── sprints ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  project       TEXT,
  goal          TEXT,
  start_date    DATE,
  end_date      DATE,
  status        TEXT        NOT NULL DEFAULT 'active',
  sprint_number INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sprints_business_id_idx ON sprints (business_id);
CREATE INDEX IF NOT EXISTS sprints_project_status_idx ON sprints (project, status);

-- ── issues ───────────────────────────────────────────────────────────────────
-- Only the columns no later migration in this directory ADD COLUMNs — see the
-- file header for why the rest (commit_sha, tester_*, designer_*,
-- deployer_status, deployer_notes, closing_notes, test_tier, heartbeat_at,
-- is_blocked, fail_count, status_category, started_at, submitted_at,
-- completed_at, worked_by, regression_test, implementation_notes,
-- reviewer_notes) are intentionally absent here.
CREATE TABLE IF NOT EXISTS issues (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key              TEXT,
  task_number           INTEGER,
  title                 TEXT        NOT NULL,
  description           TEXT,
  status                TEXT        NOT NULL DEFAULT 'backlog',
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
  business_id           UUID        REFERENCES businesses(id) ON DELETE SET NULL,
  due_date              TEXT,
  parent_id             UUID        REFERENCES issues(id) ON DELETE SET NULL,
  blocked_by            TEXT,
  resolution_type       TEXT,
  rejection_count       INTEGER     NOT NULL DEFAULT 0,
  last_rejected_at      TIMESTAMPTZ,
  last_rejection_reason TEXT,
  acceptance_criteria   TEXT,
  feature_branch        TEXT,
  pr_url                TEXT,
  transitioned_by       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS issues_project_idx     ON issues (project);
CREATE INDEX IF NOT EXISTS issues_status_idx       ON issues (status);
CREATE INDEX IF NOT EXISTS issues_assignee_idx     ON issues (assignee);
CREATE INDEX IF NOT EXISTS issues_parent_id_idx    ON issues (parent_id);
CREATE INDEX IF NOT EXISTS issues_business_id_idx  ON issues (business_id);

-- ── agents ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID        REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  adapter          TEXT        NOT NULL DEFAULT 'claude-code',
  model            TEXT,
  api_key_enc      TEXT,
  heartbeat_every  TEXT,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agents_business_id_idx ON agents (business_id);

-- ── agent_runs ───────────────────────────────────────────────────────────────
-- Both `completed_at` (read by app/api/agents/route.ts) and `finished_at`
-- (written by app/api/run-agent/route.ts and lib/issues.ts logAgentRun()) are
-- real, independently-used column names in the current code — kept as two
-- distinct columns rather than guessed to be the same one.
CREATE TABLE IF NOT EXISTS agent_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT        NOT NULL,
  task_id       UUID        REFERENCES issues(id) ON DELETE SET NULL,
  task_title    TEXT,
  status        TEXT        NOT NULL DEFAULT 'running',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  tokens_used   INTEGER,
  cost_usd      NUMERIC,
  output        TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx    ON agent_runs (agent_id);
CREATE INDEX IF NOT EXISTS agent_runs_task_id_idx     ON agent_runs (task_id);
CREATE INDEX IF NOT EXISTS agent_runs_started_at_idx  ON agent_runs (started_at DESC);

-- ── chat_conversations ─────────────────────────────────────────────────────
-- id is TEXT, not UUID: components/tabs/ChatTab.tsx generates it client-side
-- as `'chat-' + Date.now()`, which is not a UUID.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id             TEXT        PRIMARY KEY,
  title          TEXT,
  model          TEXT,
  agent_id       TEXT,
  project        TEXT,
  pinned         BOOLEAN     NOT NULL DEFAULT FALSE,
  system_prompt  TEXT,
  forked_from    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── chat_messages ────────────────────────────────────────────────────────────
-- id is TEXT for the same reason as chat_conversations.id.
CREATE TABLE IF NOT EXISTS chat_messages (
  id               TEXT        PRIMARY KEY,
  conversation_id  TEXT        REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL,
  content          TEXT,
  model            TEXT,
  image_url        TEXT,
  bookmarked       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_id_idx ON chat_messages (conversation_id);

-- ── milestones ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestones (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project      TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'planned',
  due_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS milestones_project_idx ON milestones (project);

-- ── workflow_transitions ────────────────────────────────────────────────────
-- Verbatim shape from config/migrations/008_add_task_workflow.sql, the
-- companion repo's own authoritative CREATE TABLE for this table — reused
-- here rather than re-derived, since it is already the real source of truth
-- production seeds from. The seed data itself stays in that repo; this file
-- only creates the table shape so app/api/issues/route.ts's two
-- `.select('condition_role, validators, post_functions')` queries and the
-- migrations in this directory (005, 007, 020, 023, 028, 029, 030, 031, 032,
-- 033, 035) that INSERT/UPDATE workflow_transitions rows have something to
-- write into.
CREATE TABLE IF NOT EXISTS workflow_transitions (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  issue_type      TEXT        NOT NULL,
  from_status     TEXT        NOT NULL,
  to_status       TEXT        NOT NULL,
  condition_role  TEXT,
  validators      JSONB,
  post_functions  JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_transitions_type_from_to
  ON workflow_transitions (issue_type, from_status, to_status);

-- ── role_permissions ─────────────────────────────────────────────────────────
-- Join-table shape from lib/rbac-types.ts RolePermission: { role, permission }.
CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

-- ── quick_actions ────────────────────────────────────────────────────────────
-- Shape from lib/quick-actions-constants.ts QuickAction. `id` defaults so
-- app/api/quick-actions/route.ts's POST (which never sends an id — see the
-- body destructure) still gets a real primary key on insert instead of
-- failing NOT NULL, rather than the fabricated-row workaround this piece
-- also removes from lib/quick-actions.ts listQuickActions().
CREATE TABLE IF NOT EXISTS quick_actions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT        NOT NULL,
  icon        TEXT,
  action_type TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}',
  sort_order  INTEGER     NOT NULL DEFAULT 99,
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quick_actions_enabled_sort_idx ON quick_actions (enabled, sort_order);
