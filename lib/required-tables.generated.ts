// ─── AUTO-GENERATED — do not hand-edit ─────────────────────────────────────
//
// Produced by scripts/generate-required-tables.mjs from every .from('<table>') call
// site under app/ and lib/ (excluding __tests__). Regenerate with:
//   npm run generate:required-tables
// Wired into `npm run build` via the `prebuild` script so this list tracks
// the code that was just built rather than drifting from it.

/** Every table the running app queries directly, derived mechanically. */
export const GENERATED_REQUIRED_TABLES = [
  'activity_events',
  'agent_budgets',
  'agent_cost_log',
  'agent_document_history',
  'agent_documents',
  'agent_heartbeats',
  'agent_memory',
  'agent_memory_files',
  'agent_run_records',
  'agent_runs',
  'agents',
  'businesses',
  'chat_conversations',
  'chat_messages',
  'connections',
  'deploy_history',
  'inbox',
  'issues',
  'milestones',
  'notifications',
  'projects',
  'quick_actions',
  'releases',
  'role_permissions',
  'sprints',
  'token_ledger',
  'workflow_transitions',
  'workspace_members',
  'workspaces',
] as const
