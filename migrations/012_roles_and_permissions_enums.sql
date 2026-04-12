-- TOD-1052 (2026-04-12): create roles enum and permissions enum.
--
-- roles: identity categories for users and bots
-- permissions: granular API actions and UI capabilities
--
-- Both use DO $$ blocks for idempotency (IF NOT EXISTS on TYPE requires PG 9.6+
-- but CREATE TYPE has no IF NOT EXISTS — so we guard via pg_type lookup).

-- ============================================================
-- UP
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'god',
      'admin',
      'viewer',
      'tron',
      'defaultbot'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'permission') THEN
    CREATE TYPE permission AS ENUM (
      -- Issue / board operations
      'read_issues',
      'write_issues',
      'delete_issues',
      'transition_issues',

      -- Sprint operations
      'read_sprints',
      'write_sprints',

      -- User management
      'manage_users',
      'read_users',

      -- God-level overrides
      'god_manage',

      -- Human-required gates (inbox approval flows)
      'human_required_deploy',
      'human_required_merge',
      'human_required_spend',
      'human_required_delete',
      'human_required_external_write',

      -- Agent operations
      'spawn_agents',
      'stop_agents',
      'read_agent_logs',

      -- Token ledger
      'read_token_ledger',
      'write_token_ledger',

      -- UI capabilities
      'ui_admin_panel',
      'ui_god_panel',
      'ui_inbox',
      'ui_sprint_manage',
      'ui_agent_dashboard'
    );
  END IF;
END $$;

-- ============================================================
-- DOWN  (run manually to revert)
-- ============================================================
-- DROP TYPE IF EXISTS permission;
-- DROP TYPE IF EXISTS user_role;
