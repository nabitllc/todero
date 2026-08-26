// lib/bolt-time.ts
//
// TOD-2413 (bolt-time), TOD-2414 (the writer half).
//
// Every bolt/sprint time decision reachable from the Now and Work surfaces:
// parsing a boundary, stamping one, classifying a window, formatting what
// remains, and choosing which row a card's headline describes.
//
// Scoped deliberately rather than claimed absolutely. An earlier version of
// this line said "every bolt-time decision lives here and nowhere else" and a
// critic falsified it in one grep: components/tabs/BoardTab.tsx carried its own
// window classification. That copy now calls toBoundaryString, but the honest
// form of the claim is the list above, which can be checked, not the word
// "everywhere", which cannot.
//
// Round 4 of wave 6 hardened `formatRemaining` against the TOD-2401 rounding
// bug and left the SELECTION that feeds it unguarded, so the landing screen
// rendered "ended left" while a live bolt had 8h58m to run, and stamped a
// hardcoded "24h" badge on a row that had no start date at all. Both defects
// were possible because the clock logic lived inline in one card. It lives
// here now, and the Work destination's bolt board consumes this rather than
// growing a second copy.
//
// ── The facts this module exists to respect ─────────────────────────────────
//
// 1. A date-only string parses as UTC. `new Date('2026-08-27')` is
//    2026-08-27T00:00:00Z, which for an operator at UTC-4 is 8pm on the 26th —
//    so an unmodified parse makes a bolt read "ended" four hours early. Bolt
//    boundaries are wall-clock dates, so they are parsed as LOCAL midnight.
//
// 2. Because of (1), a boundary must be WRITTEN the same way it is read.
//    `new Date().toISOString().split('T')[0]` is the UTC date, and after
//    20:00 in a UTC-4 zone that is TOMORROW — so a bolt written that way and
//    read by `parseBoundary` starts in the future, and renders a "24h" badge
//    above "26h 26m left" with a 0%-elapsed bar. That is the round-4 defect
//    reappearing through the writer instead of the reader. Every caller that
//    stamps a boundary must use `toBoundaryString`, and there is a round-trip
//    test asserting the writer's output survives the reader.
//
// 3. Column types differ by store, so this module does NOT assume a precision.
//    `migrations/000_baseline_schema.sql:76-77` declares DATE for Postgres/Neon,
//    but the live SQLite store types both columns TEXT and round-trips a full
//    `2026-08-25T20:00:00` correctly. An earlier version of this comment claimed
//    hour-accurate bolts were structurally impossible and needed a migration;
//    that is true of the Postgres baseline only, and was wrong about the
//    deployment actually running. `parseBoundary` therefore respects whatever
//    precision the value carries rather than flattening it to a date.

import { formatCountdown } from './time'

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

/**
 * Stamp a boundary the way `parseBoundary` reads one: the LOCAL calendar date.
 *
 * Every writer must use this. `new Date().toISOString().split('T')[0]` is the
 * UTC date, and a writer using it disagrees with this module's reader by the
 * operator's offset — which at UTC-4 means that after 8pm it writes tomorrow,
 * and the bolt opens in the future. The round-trip test in
 * lib/__tests__/bolt-time.test.ts asserts writer-then-reader holds; it fails
 * against `toISOString().split('T')[0]`.
 */
export function toBoundaryString(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * TOD-2415. The hour a bolt opens and closes, local time. Default 5am — the
 * owner's: "bolts should start/finish at 5am local time by default."
 *
 * Configurable per hub via the `bolt_start_hour` setting (Settings ->
 * Automations). This constant is only the fallback when no row exists.
 */
export const DEFAULT_BOLT_START_HOUR = 5

/**
 * Validate an hour off the settings table.
 *
 * The store holds TEXT, so anything can arrive: "25", "-1", "5.5", "abc", "".
 * An unvalidated read here renders a bolt opening at 25:00, which is the class
 * of defect this module exists to prevent. Returns null for anything that is
 * not a whole hour in [0, 23]; callers fall back to the default rather than
 * inventing one.
 */
export function parseStartHour(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  let n: number
  if (typeof value === 'number') {
    n = value
  } else {
    // Number(' ') is 0 and Number('1e1') is 10, so a whitespace row would have
    // silently become midnight and "1e1" a valid hour. Require plain digits
    // before converting — a caught test failure, not a hypothetical.
    if (!/^\d+$/.test(value.trim()) || value.trim() !== value) return null
    n = Number(value)
  }
  if (!Number.isInteger(n) || n < 0 || n > 23) return null
  return n
}

/**
 * The 24-hour bolt window containing `now`, as local timestamps.
 *
 * Anchored to `startHour` local: at 5am, a bolt opened at 05:00 today runs to
 * 05:00 tomorrow. Before 5am you are still inside YESTERDAY's bolt, which is
 * the case a naive "today at 5am" would get wrong — it would place `now`
 * before the window it just claimed to contain, and the landing screen would
 * show a negative elapsed and a full countdown at 4:59am.
 *
 * Emits ISO-like local timestamps (no trailing Z) so `parseBoundary` reads
 * them back at exactly this instant. `toBoundaryString` remains the date-only
 * stamp for callers that genuinely want a whole day.
 */
export function boltWindow(startHour: number, now: Date = new Date()): { start: string; end: string } {
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHour, 0, 0, 0)
  // Before the anchor hour, the live bolt is the one that opened yesterday.
  if (now.getTime() < anchor.getTime()) anchor.setDate(anchor.getDate() - 1)
  const end = new Date(anchor.getTime() + 86400000)
  return { start: toLocalTimestamp(anchor), end: toLocalTimestamp(end) }
}

/** `YYYY-MM-DDTHH:mm:ss` in LOCAL time — no zone suffix, so parseBoundary's
 *  `new Date(value)` reads it as local, matching how it was written. */
export function toLocalTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Render a duration as the window's own length. Hours under two days, days above. */
function windowLabelFor(windowMs: number): string {
  // TOD-2434: delegates to the one clock. Kept as a named wrapper because the
  // word "window" is what this call site means; the ARITHMETIC is no longer
  // duplicated here. formatCountdown carries the TOD-2401 rule — hours, never
  // days, right up to 48h — which is exactly what a window label needs.
  return formatCountdown(windowMs)
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
  // TOD-2434: this is now one line over lib/time.ts. The rule it existed to
  // enforce — never day units under 48h, because a 24h bolt reading "0 days
  // left" with nine hours to run is the TOD-2401 fabrication — lives in
  // formatCountdown and is asserted in lib/__tests__/time.test.ts. Nine
  // independent formatters produced six spellings of one duration; this file
  // owned two of them.
  return formatCountdown(ms)
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
