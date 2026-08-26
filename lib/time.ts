// TOD-XXX (2026-04-10): Single source of truth for ET-local time handling.
//
// Why this file exists: LaunchAgent comments across this codebase have drifted
// between UTC and ET multiple times. The bug that froze the pipeline overnight
// on 2026-04-10 was a sprint-cycle plist commenting "= 10:55 UTC" while launchd
// uses local time. pipeline.ts + OverviewTab.tsx hardcoded "7am EDT = 11:00 UTC"
// assuming EDT forever — breaks the second clocks change in November.
//
// Rule going forward: all scheduling math and display lives in THIS file.
// Everything else imports from here.
//
// ISO 8601 storage stays UTC. Display + scheduling happens in ET.
//
// ── one-clock (2026-08-26) ──────────────────────────────────────────────────
//
// That rule above was written and then not honoured: for months this file had
// ZERO importers while thirteen ad-hoc duration formatters lived in thirteen
// other files, producing up to six different spellings of one duration (90s
// rendered as "1m", "2m", "1m 30s", "1m ago" and "2m ago", depending on which
// surface you were looking at). The declared single source of truth was dead
// code. See docs/rebuild/pieces/pieces6/one-clock.md.
//
// The duration half of the clock now lives here — see the DURATIONS section at
// the bottom of this file — and the header is true again because things import
// it. lib/fleet-liveness.ts's formatAge, whose algorithm was judged
// authoritative (pure, no "ago" suffix, unit-correct past 24h, already tested),
// moved here as `formatDuration` and is re-exported from there.
//
// It moved with exactly ONE change: seconds are TRUNCATED, not rounded, so
// that the whole module obeys one rule (see TRUNCATE, NEVER ROUND below).
// formatAge rounded, so 3.999s read "4s" — a claim that four seconds had
// elapsed when they had not. Every value formatAge's own tests assert is a
// whole number of seconds, so they pass unchanged; the difference is visible
// only on sub-second fractions, where truncating is the honest direction.

export const ET_TZ = 'America/New_York'

/** Current moment as a Date (always UTC internally, but rendered ET by helpers below). */
export function now(): Date {
  return new Date()
}

/**
 * Format a Date as YYYY-MM-DD in ET (the sprint-key format used by issues.sprint).
 * Works across DST transitions.
 */
export function etDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) // en-CA gives YYYY-MM-DD
}

/** The current hour in ET (0-23), DST-correct. */
export function etHour(d: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: ET_TZ, hour: 'numeric', hour12: false }).format(d),
    10
  )
}

/** The current minute in ET (0-59). */
export function etMinute(d: Date = new Date()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: ET_TZ, minute: 'numeric' }).format(d),
    10
  )
}

/**
 * Return the next Date matching `hour:minute` ET, relative to `now`.
 * Handles DST automatically — you pass 7am ET and get the correct UTC moment
 * whether you're in EST (UTC-5) or EDT (UTC-4).
 */
export function nextEtTime(hour: number, minute = 0, from: Date = new Date()): Date {
  // Start with today at the target hour in ET, expressed as a UTC timestamp.
  const todayEt = etDateKey(from) // YYYY-MM-DD in ET
  // Parse the date-time string with the ET timezone offset at that moment.
  // We use a sentinel second to make the round-trip unambiguous.
  const candidate = new Date(
    new Date(`${todayEt}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)
      .toLocaleString('en-US', { timeZone: ET_TZ })
  )
  // The above may yield a date interpreted as local — safer approach:
  // Construct via a known offset by computing the UTC timestamp explicitly.
  // Use the offset helper below.
  const offset = etOffsetMinutes(from)
  // offset is ET minutes - UTC minutes (negative west). For EST: -300. EDT: -240.
  const [y, m, d] = todayEt.split('-').map(Number)
  // Build "midnight ET" as UTC timestamp.
  const midnightUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offset * 60_000
  const targetMs = midnightUtcMs + (hour * 60 + minute) * 60_000
  let next = new Date(targetMs)
  if (next <= from) next = new Date(next.getTime() + 24 * 60 * 60 * 1000)
  return next
}

/**
 * The ET offset in minutes RELATIVE TO UTC at a given moment.
 * EST = -300 (UTC-5), EDT = -240 (UTC-4).
 */
export function etOffsetMinutes(d: Date = new Date()): number {
  // Format the date in ET as an ISO string with offset, then parse the offset.
  // Intl.DateTimeFormat doesn't expose the offset directly, so we compute it by
  // comparing the "wall-clock" rendering in ET vs UTC.
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value
    return acc
  }, {})
  const etWall = Date.UTC(
    parseInt(etParts.year, 10),
    parseInt(etParts.month, 10) - 1,
    parseInt(etParts.day, 10),
    parseInt(etParts.hour, 10) % 24,
    parseInt(etParts.minute, 10),
    parseInt(etParts.second, 10),
  )
  // etWall - actualUtcMs = offset in ms
  return Math.round((etWall - d.getTime()) / 60_000)
}

/** Human-readable ET time for display. */
export function etFormat(d: Date = new Date(), opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...opts,
  }).format(d)
}

/**
 * Pipeline helper: next PR window (7am or 7pm ET).
 * DST-correct via nextEtTime().
 */
export function nextPRWindow(from: Date = new Date()): Date {
  const w7am = nextEtTime(7, 0, from)
  const w7pm = nextEtTime(19, 0, from)
  return w7am < w7pm ? w7am : w7pm
}

// ─── DURATIONS ───────────────────────────────────────────────────────────────
//
// One decomposition, two rendering modes, three thin timestamp adapters.
// Spec + acceptance table: docs/rebuild/pieces/pieces6/one-clock.md
//
// TWO MODES, AND WHY THERE ARE TWO AND NOT ONE
//
//   formatDuration  — elapsed / age.  Days appear from 24h up.  26h -> "1d 2h"
//   formatCountdown — remaining.      Days appear from 48h up.  26h -> "26h"
//
// The second rule is load-bearing, not stylistic. lib/bolt-time.ts documents
// it: a 24h bolt with nine hours left must never render "0 days left" — that
// fabrication is what TOD-2401 deleted. So under 48h a countdown counts in
// hours and refuses day units entirely. An AGE has no such hazard: "1d 2h ago"
// is true, readable, and is what design/Fleet.dc.html specifies.
//
// 26h is therefore the ONLY input with two renderings in this whole module,
// and the two can never be confused because the word beside them differs
// ("left" vs "ago"). Every other arithmetic difference among the thirteen
// formatters this replaced was an accident, and is deleted.
//
// TRUNCATE, NEVER ROUND
//
// Every unit is truncated. A duration must never claim more of a unit than has
// actually elapsed, or more time than actually remains. The two formatters
// that used to round to whole minutes first are why 90s read "2m" on the bolt
// card and "1m" on the Fleet roster. Truncation also fixes, more simply, the
// bug that rounding was introduced to prevent: 1h59m58s truncates to
// "1h 59m" and can never carry into a literal "60m".

export type TimeInput = string | number | Date | null | undefined

/**
 * The ONE parse. Milliseconds since epoch, or null when there is nothing to
 * measure — an absent, empty or unparseable value.
 *
 * Returns null rather than NaN or 0 so that callers are forced to decide what
 * to print for "no timestamp". The Fleet lesson, applied to the clock: a
 * missing time must not render as a plausible age.
 */
export function toEpochMs(at: TimeInput): number | null {
  if (at === null || at === undefined || at === '') return null
  const ms = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : new Date(at).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** The one decomposition. Everything below reads its units from here. */
function unitsOf(ms: number) {
  const totalSeconds = Math.max(0, Math.trunc(ms / 1000))
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  const totalDays = Math.floor(totalHours / 24)
  return {
    totalSeconds,
    totalMinutes,
    totalHours,
    totalDays,
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
  }
}

/** "13d" / "13d 4h" — never "13d 0h". The trailing unit is dropped when zero. */
function pair(big: number, bigUnit: string, small: number, smallUnit: string): string {
  return small === 0 ? `${big}${bigUnit}` : `${big}${bigUnit} ${small}${smallUnit}`
}

/**
 * ELAPSED / AGE. The canonical spelling of a duration in this app.
 *
 * "4s" · "11s" · "15m" · "4h 12m" · "1d 2h". At most two units, largest first,
 * every unit truncated. A negative input clamps to "0s" — a future timestamp is
 * reported by its caller as clock skew, not as a negative age.
 *
 * This is lib/fleet-liveness.ts's formatAge, moved verbatim. That module
 * re-exports this, so its tests assert this function.
 */
export function formatDuration(ms: number): string {
  const u = unitsOf(ms)
  if (u.totalSeconds < 60) return `${u.totalSeconds}s`
  if (u.totalMinutes < 60) return `${u.totalMinutes}m`
  if (u.totalHours < 24) return pair(u.totalHours, 'h', u.minutes, 'm')
  return pair(u.totalDays, 'd', u.hours, 'h')
}

/**
 * REMAINING. Same decomposition, three deliberate differences, each one a
 * defect this codebase already shipped once:
 *
 *   1. `ms <= 0` is "ended", never "0s". Round 4 of wave 6 paired a bare
 *      number with the unconditional word "left" and rendered "ended left";
 *      the word lives here so a caller cannot make that mistake.
 *   2. Under a minute is "<1m", never "0m" and never "0s". A countdown does
 *      not claim second-precision on a value polled at minute cadence, and the
 *      alternative is the "0 units left" shape one unit further down.
 *      formatDuration has no such guard because "45s" elapsed is exactly true.
 *   3. NO DAY UNITS UNDER 48h. This is TOD-2401: a 24h bolt with nine hours to
 *      run must never render "0 days left". Hours all the way to 48h.
 *
 * Also renders a window's own LENGTH ("24h", "14d"), because the length of a
 * window is the countdown taken at its start, and it must obey rule 3 for the
 * same reason the countdown does.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'ended'
  const u = unitsOf(ms)
  if (u.totalSeconds < 60) return '<1m'
  if (u.totalMinutes < 60) return `${u.totalMinutes}m`
  // Rule 3: hours, not days, right up to 48h.
  if (u.totalHours < 48) return pair(u.totalHours, 'h', u.minutes, 'm')
  return pair(u.totalDays, 'd', u.hours, 'h')
}

/**
 * The age of a timestamp, with the direction said out loud: "5s ago", "in 4m".
 *
 * Returns the EMPTY STRING for an absent or unparseable timestamp — never a
 * guess, never "0s ago". A caller that wants words for the missing case writes
 * them itself (`formatAgo(x) || 'created_at is null'`).
 */
export function formatAgo(at: TimeInput, now: number = Date.now()): string {
  const t = toEpochMs(at)
  if (t === null) return ''
  const delta = now - t
  return delta >= 0 ? `${formatDuration(delta)} ago` : `in ${formatDuration(-delta)}`
}

/**
 * How long since a timestamp — a bare duration, no suffix. For "this run has
 * been going 14h 37m".
 *
 * null, not "0s", when there is no timestamp: the caller must decide what an
 * unmeasured run looks like.
 */
export function formatSince(at: TimeInput, now: number = Date.now()): string | null {
  const t = toEpochMs(at)
  if (t === null) return null
  return formatDuration(Math.max(0, now - t))
}

/**
 * How long something took. `end` of null means "still going — measure to now",
 * which is why every caller must LABEL which of the two it is showing: 30s
 * (start->completed) and 14h 37m (start->now) are both correct, and a bare
 * duration beside a run title says nothing about which one it is. That was the
 * actual defect on the Runs surface.
 */
export function formatElapsedBetween(
  start: TimeInput,
  end: TimeInput,
  now: number = Date.now(),
): string | null {
  const from = toEpochMs(start)
  if (from === null) return null
  const to = toEpochMs(end) ?? now
  return formatDuration(Math.max(0, to - from))
}
