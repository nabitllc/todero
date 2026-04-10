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
