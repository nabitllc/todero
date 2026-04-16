// ── Project prefix map (shared between API routes, migrations, and tests) ───
// TOD-XXX (2026-04-13): Infrastructure changed INF → TOD. All projects now use
// TOD-* prefix except legacy MC/VES/KEM which keep theirs for backward compat.
// No new INF-* issues will ever be created. Existing INF-* stay as-is in DB.
export const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC',
  Infrastructure: 'TOD',
  Vespera: 'VES',
  Kemuni: 'KEM',
  Todero: 'TOD',
}

const PROJECT_ALIASES: Record<string, string> = {
  'mission control': 'Mission Control',
  missioncontrol: 'Mission Control',
  mc: 'Mission Control',
  infrastructure: 'Infrastructure',
  inf: 'Infrastructure',
  vespera: 'Vespera',
  ves: 'Vespera',
  kemuni: 'Kemuni',
  kem: 'Kemuni',
  todero: 'Todero',
  tod: 'Todero',
}

export function normalizeProjectName(project: string | null | undefined): string {
  const raw = typeof project === 'string' ? project.trim() : ''
  if (!raw) return 'Todero'

  const alias = PROJECT_ALIASES[raw.toLowerCase()]
  if (alias) return alias

  return raw
}

export function getProjectPrefix(project: string | null | undefined): string {
  return PROJECT_PREFIX[normalizeProjectName(project)] ?? 'TOD'
}

// ── Enum constants (single source of truth) ──────────────────────────────────
export const VALID_TYPES = ['epic', 'feature', 'task', 'bug', 'ops', 'research']
export const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low']
export const VALID_SEVERITIES = ['S0', 'S1', 'S2', 'S3']
export const VALID_STATUSES = [
  'backlog', 'closed',
  'refined', 'open', 'in_progress', 'code_review', 'product_review', 'approved', 'released',
  'defined', 'underway', 'feature_review',
  'draft', 'active', 'wrapped',
]
export const RETIRED_STATUSES = ['in_review', 'done', 'blocked', 'completed']
export const VALID_RESOLUTION_TYPES = [
  'code_change',        // Code was written/modified (task, bug, ops)
  'config_change',      // Configuration/settings changed, no code (ops)
  'database_change',    // Schema migration, data fix (ops)
  'research_completed', // Research done, findings documented (research)
  'documentation',      // Docs written/updated, no code (any)
  'duplicate',          // Issue is a duplicate of another
  'by_design',          // Behavior is by design (legacy alias for expected_behavior)
  'expected_behavior',  // Reported behavior is by design (bug)
  'wont_fix',           // Acknowledged but won't be fixed
  'not_reproducible',   // Bug cannot be reproduced
  'deferred',           // Postponed to future work
  'no_change_required', // Investigation confirmed no action needed (superseded, redundant)
  'no_action',          // Legacy alias for no_change_required — kept for DB compat
  'completed',          // Generic completion (feature, epic)
  'cancelled',          // Legacy — kept for DB compat; use wont_fix for new issues
]
