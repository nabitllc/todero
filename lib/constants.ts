// ── Project prefix map (shared between API routes, migrations, and tests) ───
export const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC',
  Infrastructure: 'INF',
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
export const VALID_STATUSES = ['backlog', 'defined', 'open', 'in_progress', 'code_review', 'product_review', 'approved', 'released', 'completed', 'closed', 'draft', 'active']
export const RETIRED_STATUSES = ['in_review', 'done', 'blocked']
export const VALID_RESOLUTION_TYPES = ['code_change', 'config_change', 'no_action', 'duplicate', 'by_design', 'wont_fix', 'not_reproducible', 'deferred', 'completed']
