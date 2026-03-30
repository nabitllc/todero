// ── Project prefix map (shared between API routes and tests) ─────────────────
export const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC',
  Infrastructure: 'INF',
  Vespera: 'VES',
  Kemuni: 'KEM',
  Todero: 'TOD',
  todero: 'TOD',
}

// ── Enum constants (single source of truth) ──────────────────────────────────
export const VALID_TYPES = ['epic', 'feature', 'task', 'bug', 'ops', 'research']
export const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low']
export const VALID_SEVERITIES = ['S0', 'S1', 'S2', 'S3']
export const VALID_STATUSES = ['backlog', 'defined', 'open', 'in_progress', 'in_review', 'done', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'blocked', 'draft', 'active']
export const VALID_RESOLUTION_TYPES = ['code_change', 'config_change', 'no_action', 'duplicate', 'by_design', 'wont_fix', 'cancelled', 'canceled', 'not_reproducible', 'deferred', 'completed']
