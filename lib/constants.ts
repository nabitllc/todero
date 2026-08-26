// ── Project prefix map (shared between API routes, migrations, and tests) ───
// TOD-XXX (2026-04-13): Infrastructure changed INF → TOD. All projects now use
// TOD-* prefix except legacy MC/VES/KEM which keep theirs for backward compat.
// No new INF-* issues will ever be created. Existing INF-* stay as-is in DB.
// ── The canonical project set ───────────────────────────────────────────────
//
// no-invented-projects-sweep: `Vespera: 'VES'` and `Kemuni: 'KEM'` were entries
// here, with matching `vespera`/`ves`/`kemuni`/`kem` aliases below. Neither
// project exists. `Limiglow` — the one real managed project — takes their place.
//
// WHY REMOVING THEM DOES NOT BREAK HISTORICAL ROWS. This map is a WRITE path
// only. Its single consumer that matters is prepareIssueIdentity() in
// app/api/issues/route.ts, which calls getProjectPrefix() to mint a key for a
// NEW issue. Nothing reverse-maps a prefix back to a project: an existing row
// carries its `task_key` ('VES-12') and its `project` ('Vespera') as stored
// columns, and every read path renders those columns verbatim. So a legacy
// VES-*/KEM-* row still reads, sorts, links and displays exactly as before.
//
// The one real, cosmetic consequence, stated rather than glossed:
// components/tabs/ProjectsTab.tsx:54 does `PROJECT_PREFIX[name] ?? '—'` to show
// a "Key" column for whatever project names it finds in the issue rows. A
// legacy Vespera or Kemuni row will now show '—' in that column instead of
// 'VES'/'KEM'. That is a display of a mapping that no longer exists, which is
// the honest answer; it is not data loss, and the row's own task_key is
// unaffected.
//
// 'Mission Control' and 'Infrastructure' are deliberately KEPT. Both are dead as
// destinations for new work, but both still own a live task-key prefix for rows
// already in the table (MC-*, and INF-* which now mints as TOD-*), and
// app/api/issues/route.ts still files at least one issue under 'Mission Control'
// today. Removing them here would silently change those keys' prefix to the
// 'TOD' fallback. That is a separate decision in a file this piece does not own.
export const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC',
  Infrastructure: 'TOD',
  Todero: 'TOD',
  Limiglow: 'TOD',
}

// Every VALUE here must be a key of PROJECT_PREFIX above — that invariant is
// what scripts/no-invented-projects.mjs checks in this file, and it is why an
// alias cannot smuggle a project name back in past the guard.
const PROJECT_ALIASES: Record<string, string> = {
  'mission control': 'Mission Control',
  missioncontrol: 'Mission Control',
  mc: 'Mission Control',
  infrastructure: 'Infrastructure',
  inf: 'Infrastructure',
  todero: 'Todero',
  tod: 'Todero',
  limiglow: 'Limiglow',
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
  'defined', 'refined', 'open', 'in_progress', 'code_review', 'product_review', 'approved', 'released',
  'underway', 'feature_review',
  'draft', 'active', 'wrapped', 'completed',
]
export const RETIRED_STATUSES = ['in_review', 'done', 'blocked']
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
