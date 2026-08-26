// lib/bolt-time.ts
//
// TOD-2413 (bolt-time): every bolt/sprint time decision, in one file.
//
// Round 4 of wave 6 hardened `formatRemaining` against the TOD-2401 rounding
// bug and left the SELECTION that feeds it unguarded, so the landing screen
// rendered "ended left" while a live bolt had 8h58m to run, and stamped a
// hardcoded "24h" badge on a row that had no start date at all. Both defects
// were possible because the clock logic lived inline in one card. It lives
// here now, and the Work destination's bolt board consumes this rather than
// growing a second copy.
//
// ── The two structural facts this module exists to respect ──────────────────
//
// 1. `sprints.start_date` and `sprints.end_date` are DATE, not TIMESTAMPTZ
//    (migrations/000_baseline_schema.sql:76-77, never altered). A bolt cannot
//    carry an hour. Every bolt is midnight-to-midnight by construction, and
//    HANDOFF.md's "opens automatically at a set time" is not reachable without
//    a migration. This module renders exactly the precision the column can
//    support and no more.
//
// 2. A date-only string parses as UTC. `new Date('2026-08-27')` is
//    2026-08-27T00:00:00Z, which for an operator at UTC-4 is 8pm on the 26th —
//    so an unmodified parse makes a bolt read "ended" four hours early. Bolt
//    boundaries are wall-clock dates, so they are parsed as LOCAL midnight.

/** A row shaped like the `sprints` columns this module reads. */
export interface BoltRow {
  start_date?: string | null
  end_date?: string | null
}

export type WindowKind = 'bolt' | 'sprint' | 'unknown'

export interface ClassifiedWindow {
  /** Length of the window in ms, or null when either boundary is missing. */
  windowMs: number | null
  kind: WindowKind
  /**
   * The window's real length, rendered — "24h", "4h", "13d". NEVER a constant:
   * round 4 printed a literal "24h" for every row it decided was bolt-shaped,
   * including rows with no window at all. `null` when `kind` is 'unknown',
   * because a window nothing measured has no label.
   */
  windowLabel: string | null
}

/** A window at or under this counts as bolt-scale — 24h nominal, with slack
 *  for a bolt opened a little late. A real two-week sprint is nowhere near it. */
export const BOLT_MAX_MS = 30 * 3600000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parse a boundary from the `sprints` table.
 *
 * A bare `YYYY-MM-DD` is a wall-clock date, so it is parsed as LOCAL midnight.
 * `new Date(s)` would parse it as UTC midnight and shift the boundary by the
 * operator's offset — four hours, in the owner's case, which is enough to
 * render a running bolt as ended on the landing screen.
 *
 * A value that already carries a time is respected as-is: if the column is ever
 * migrated to TIMESTAMPTZ, this function needs no change.
 */
export function parseBoundary(value: string | null | undefined): Date | null {
  if (!value) return null
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d) // local midnight
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Render a duration as the window's own length. Hours under two days, days above. */
function windowLabelFor(windowMs: number): string {
  if (windowMs < 48 * 3600000) {
    const h = Math.round(windowMs / 3600000)
    return h < 1 ? `${Math.round(windowMs / 60000)}m` : `${h}h`
  }
  return `${Math.round(windowMs / 86400000)}d`
}

/**
 * Classify a row's window from its REAL boundaries.
 *
 * A missing boundary yields 'unknown' — not 'bolt'. Round 4's ternary read
 * `windowMs === null ? 'Bolt' : ...`, so a row with no start date was labelled
 * a bolt and badged "24h" while showing "10d left" beneath. Nothing measured
 * that row's window, so this returns a kind that renders no badge.
 */
export function classifyWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): ClassifiedWindow {
  const startsAt = parseBoundary(start)
  const endsAt = parseBoundary(end)
  if (!startsAt || !endsAt) return { windowMs: null, kind: 'unknown', windowLabel: null }

  const windowMs = endsAt.getTime() - startsAt.getTime()
  if (windowMs <= 0) return { windowMs, kind: 'unknown', windowLabel: null }

  return {
    windowMs,
    kind: windowMs <= BOLT_MAX_MS ? 'bolt' : 'sprint',
    windowLabel: windowLabelFor(windowMs),
  }
}

/**
 * Render a remaining duration.
 *
 * Moved verbatim from OverviewTab.tsx, where it was correct — the point of the
 * move is that there is now one copy. Never invokes day math under 48h: it
 * reads real hours and minutes off the millisecond difference, so there is no
 * rounding step that can collapse "9 hours left" into "0 days left", which is
 * the fabrication TOD-2401 deleted.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'ended'
  // Round to a single whole-minute integer FIRST, then derive h/m from THAT
  // integer via floor/mod. Rounding the leftover minutes independently of the
  // floored hour can round 59.97 minutes up to a literal "60m" instead of
  // carrying into the next hour.
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  if (totalMinutes < 48 * 60) {
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.floor(ms / 86400000)}d`
}

/**
 * The headline result for a set of rows.
 *
 * Discriminated on purpose. Round 4 returned a bare number and paired it with
 * the unconditional word "left", so an expired row produced the string
 * "ended left". A caller cannot make that mistake against this type: there is
 * no `remainingMs` to read on an 'ended' or 'none' result.
 */
export type BoltHeadline<T> =
  | { state: 'live'; row: T; remainingMs: number }
  | { state: 'ended'; row: T; endedMsAgo: number }
  | { state: 'none' }

/**
 * Pick the row the card's one big number should describe.
 *
 * The soonest row whose end is still in the FUTURE. Round 4 reduced on
 * `remainingMs` with `<=`, and `remainingMs` goes NEGATIVE once a row expires,
 * so an expired row always won — the more expired, the more certainly it won.
 * A dead row hijacking a live countdown is exactly TOD-2401.
 *
 * Only when no row is live does this fall back, and it reports that it did.
 */
export function pickHeadline<T extends BoltRow>(rows: readonly T[], now = Date.now()): BoltHeadline<T> {
  let live: { row: T; remainingMs: number } | null = null
  let ended: { row: T; endedMsAgo: number } | null = null

  for (const row of rows) {
    const endsAt = parseBoundary(row.end_date)
    if (!endsAt) continue // a row with no end has no countdown to contribute
    const remainingMs = endsAt.getTime() - now

    if (remainingMs > 0) {
      if (!live || remainingMs < live.remainingMs) live = { row, remainingMs }
    } else {
      const endedMsAgo = -remainingMs
      if (!ended || endedMsAgo < ended.endedMsAgo) ended = { row, endedMsAgo }
    }
  }

  if (live) return { state: 'live', row: live.row, remainingMs: live.remainingMs }
  if (ended) return { state: 'ended', row: ended.row, endedMsAgo: ended.endedMsAgo }
  return { state: 'none' }
}
