// lib/__tests__/time.test.ts — one-clock (pieces6)
//
// Spec: docs/rebuild/pieces/pieces6/one-clock.md
//
// Every row of that document's ACCEPTANCE tables is asserted here as an EXACT
// string. That is the whole point of the piece: thirteen duration formatters
// produced six spellings of one duration, and the reason nobody noticed is
// that not one of them had a test asserting what it actually printed. A table
// in a doc with no test behind it is how they come back.

import {
  formatAgo,
  formatCountdown,
  formatDuration,
  formatElapsedBetween,
  formatSince,
  toEpochMs,
} from '../time'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatDuration — elapsed / age, one rendering per input', () => {
  const table: Array<[number, string]> = [
    [-5 * SECOND, '0s'],
    [0, '0s'],
    [3_999, '3s'],
    [4 * SECOND, '4s'],
    [11 * SECOND, '11s'],
    [45 * SECOND, '45s'],
    [59_400, '59s'],
    [90 * SECOND, '1m'],
    [15 * MINUTE, '15m'],
    [59 * MINUTE + 30 * SECOND, '59m'],
    [60 * MINUTE, '1h'],
    [4 * HOUR + 12 * MINUTE, '4h 12m'],
    [23 * HOUR + 59 * MINUTE, '23h 59m'],
    [24 * HOUR, '1d'],
    [26 * HOUR, '1d 2h'],
    [47 * HOUR, '1d 23h'],
    [13 * DAY, '13d'],
    [13 * DAY + 4 * HOUR, '13d 4h'],
  ]

  it.each(table)('formatDuration(%i) === %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })

  it('truncates rather than rounds — the one change from fleet-liveness formatAge', () => {
    // Rounding claimed four seconds had elapsed when 3.999 had.
    expect(formatDuration(3_999)).toBe('3s')
    expect(formatDuration(3_999)).not.toBe('4s')
    // And it never jumps a whole unit early: 59.9s is still under a minute.
    expect(formatDuration(59_900)).toBe('59s')
    expect(formatDuration(59_900)).not.toBe('1m')
  })

  it('never renders a trailing zero unit', () => {
    expect(formatDuration(3 * HOUR)).toBe('3h')
    expect(formatDuration(3 * HOUR)).not.toBe('3h 0m')
    expect(formatDuration(2 * DAY)).toBe('2d')
    expect(formatDuration(2 * DAY)).not.toBe('2d 0h')
  })

  it('a future duration clamps to 0s rather than rendering a negative age', () => {
    expect(formatDuration(-5 * HOUR)).toBe('0s')
    expect(formatDuration(-5 * HOUR)).not.toContain('-')
  })
})

describe('formatCountdown — remaining, one rendering per input', () => {
  const table: Array<[number, string]> = [
    [-5 * HOUR, 'ended'],
    [0, 'ended'],
    [1, '<1m'],
    [20 * SECOND, '<1m'],
    [59 * SECOND, '<1m'],
    [90 * SECOND, '1m'],
    [45 * MINUTE, '45m'],
    [59 * MINUTE + 30 * SECOND, '59m'],
    [HOUR + 59.97 * MINUTE, '1h 59m'],
    [9 * HOUR, '9h'],
    [9 * HOUR + 58 * MINUTE, '9h 58m'],
    [24 * HOUR, '24h'],
    [26 * HOUR, '26h'],
    [47 * HOUR, '47h'],
    [48 * HOUR, '2d'],
    [13 * DAY, '13d'],
    [13 * DAY + 4 * HOUR, '13d 4h'],
  ]

  it.each(table)('formatCountdown(%i) === %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected)
  })

  // One negative assertion per defect this codebase has actually shipped.

  it('TOD-2401: never collapses hours into "0 days"', () => {
    expect(formatCountdown(9 * HOUR)).toBe('9h')
    expect(formatCountdown(9 * HOUR)).not.toBe('0d')
    expect(formatCountdown(9 * HOUR)).not.toContain('d')
  })

  it('refuses day units anywhere under 48h, and takes them up at exactly 48h', () => {
    expect(formatCountdown(47 * HOUR + 59 * MINUTE)).toBe('47h 59m')
    expect(formatCountdown(47 * HOUR + 59 * MINUTE)).not.toContain('d')
    expect(formatCountdown(48 * HOUR)).toBe('2d')
  })

  it('never prints "0 units left" one unit down from the day bug', () => {
    expect(formatCountdown(20 * SECOND)).toBe('<1m')
    expect(formatCountdown(20 * SECOND)).not.toBe('0m')
    expect(formatCountdown(20 * SECOND)).not.toBe('0s')
    expect(formatCountdown(1)).toBe('<1m')
  })

  it('carries 59.97 minutes without ever printing a literal "60m"', () => {
    const v = formatCountdown(HOUR + 59.97 * MINUTE)
    expect(v).toBe('1h 59m')
    expect(v).not.toContain('60m')
    // ...and does not round UP past the time that actually remains.
    expect(v).not.toBe('2h')
  })

  it('reports an expired window as ended, with no negative number', () => {
    expect(formatCountdown(0)).toBe('ended')
    expect(formatCountdown(-5 * HOUR)).toBe('ended')
    expect(formatCountdown(-5 * HOUR)).not.toContain('-')
  })

  it('renders a window LENGTH the same way it renders a countdown', () => {
    // lib/bolt-time.ts's windowLabelFor folds into this function; these are
    // the exact labels lib/__tests__/bolt-time.test.ts asserts.
    expect(formatCountdown(4 * HOUR)).toBe('4h')
    expect(formatCountdown(24 * HOUR)).toBe('24h')
    expect(formatCountdown(14 * DAY)).toBe('14d')
  })
})

describe('the three headline disagreements are gone', () => {
  // These are the exact rows from the piece's opening table. Before one-clock
  // each produced up to six spellings across the app.

  it('90s is "1m" in every mode', () => {
    expect(formatDuration(90 * SECOND)).toBe('1m')
    expect(formatCountdown(90 * SECOND)).toBe('1m')
    expect(formatAgo(Date.now() - 90 * SECOND)).toBe('1m ago')
    // The five spellings that used to exist:
    for (const wrong of ['2m', '1m 30s', '90s', '0h 1m']) {
      expect(formatDuration(90 * SECOND)).not.toBe(wrong)
      expect(formatCountdown(90 * SECOND)).not.toBe(wrong)
    }
  })

  it('59m 30s is "59m" in every mode', () => {
    const ms = 59 * MINUTE + 30 * SECOND
    expect(formatDuration(ms)).toBe('59m')
    expect(formatCountdown(ms)).toBe('59m')
    expect(formatAgo(Date.now() - ms)).toBe('59m ago')
    for (const wrong of ['1h', '1h 0m', '59m 30s', '0h 59m']) {
      expect(formatDuration(ms)).not.toBe(wrong)
      expect(formatCountdown(ms)).not.toBe(wrong)
    }
  })

  it('26h differs in exactly one direction, for exactly the documented reason', () => {
    // This is the ONLY input in the module with two renderings, and the two
    // are never confusable because the word beside them differs.
    expect(formatDuration(26 * HOUR)).toBe('1d 2h')
    expect(formatCountdown(26 * HOUR)).toBe('26h')
    expect(formatAgo(Date.now() - 26 * HOUR)).toBe('1d 2h ago')
    // The four spellings that used to exist and now do not.
    for (const wrong of ['26h 0m', '1560m 0s', '1560m', '1d']) {
      expect(formatDuration(26 * HOUR)).not.toBe(wrong)
      expect(formatCountdown(26 * HOUR)).not.toBe(wrong)
    }
    // A countdown must never say "1d 2h" — that is a day unit under 48h.
    expect(formatCountdown(26 * HOUR)).not.toBe('1d 2h')
  })
})

describe('toEpochMs — the one parse', () => {
  it('returns null for anything with no time in it', () => {
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs(undefined)).toBeNull()
    expect(toEpochMs('')).toBeNull()
    expect(toEpochMs('not a date')).toBeNull()
    expect(toEpochMs(NaN)).toBeNull()
    expect(toEpochMs(new Date('nope'))).toBeNull()
  })

  it('accepts a string, a number and a Date and agrees with itself', () => {
    const iso = '2026-08-26T12:00:00.000Z'
    const ms = Date.parse(iso)
    expect(toEpochMs(iso)).toBe(ms)
    expect(toEpochMs(ms)).toBe(ms)
    expect(toEpochMs(new Date(ms))).toBe(ms)
  })
})

describe('formatAgo — never fabricates an age', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z')

  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
    ['not a date', ''],
    [NaN, ''],
  ] as Array<[string | number | null | undefined, string]>)(
    'formatAgo(%p) === "" — a missing timestamp has no age',
    (input, expected) => {
      expect(formatAgo(input, now)).toBe(expected)
    },
  )

  const table: Array<[number, string]> = [
    [5 * SECOND, '5s ago'],
    [90 * SECOND, '1m ago'],
    [59 * MINUTE + 30 * SECOND, '59m ago'],
    [3 * HOUR, '3h ago'],
    [26 * HOUR, '1d 2h ago'],
    [2 * DAY, '2d ago'],
  ]

  it.each(table)('a timestamp %i ms in the past renders "%s"', (ago, expected) => {
    expect(formatAgo(new Date(now - ago).toISOString(), now)).toBe(expected)
  })

  it('says "in" for a future timestamp rather than a negative age', () => {
    expect(formatAgo(new Date(now + 4 * MINUTE).toISOString(), now)).toBe('in 4m')
    expect(formatAgo(new Date(now + 4 * MINUTE).toISOString(), now)).not.toContain('-')
  })

  it('renders the present as "0s ago", not as an empty string', () => {
    // '' is reserved for "there is no timestamp". A timestamp that IS now has
    // a real age of zero, and the two cases must not collapse.
    expect(formatAgo(now, now)).toBe('0s ago')
    expect(formatAgo(null, now)).toBe('')
  })
})

describe('formatSince / formatElapsedBetween — null, never a fabricated 0s', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z')

  it('formatSince returns null when there is no start', () => {
    expect(formatSince(null, now)).toBeNull()
    expect(formatSince(undefined, now)).toBeNull()
    expect(formatSince('not a date', now)).toBeNull()
  })

  it('formatSince measures start -> now, unsuffixed', () => {
    expect(formatSince(new Date(now - 30 * SECOND).toISOString(), now)).toBe('30s')
    expect(formatSince(new Date(now - (14 * HOUR + 37 * MINUTE)).toISOString(), now)).toBe('14h 37m')
  })

  it('formatElapsedBetween measures start -> end when the end exists', () => {
    const start = '2026-08-26T11:59:30.000Z'
    const end = '2026-08-26T12:00:00.000Z'
    expect(formatElapsedBetween(start, end, now)).toBe('30s')
  })

  it('formatElapsedBetween measures start -> now when the end is null', () => {
    // The Runs defect: the SAME run renders 30s (start->completed) and
    // 14h 37m (start->now). Both are correct; the caller must label which.
    const start = new Date(now - (14 * HOUR + 37 * MINUTE)).toISOString()
    expect(formatElapsedBetween(start, null, now)).toBe('14h 37m')
    expect(formatElapsedBetween(start, '2026-08-25T21:23:30.000Z', now)).toBe('30s')
  })

  it('formatElapsedBetween returns null when the start is missing, even with an end', () => {
    expect(formatElapsedBetween(null, '2026-08-26T12:00:00.000Z', now)).toBeNull()
  })

  it('a completed_at before started_at clamps to 0s rather than going negative', () => {
    expect(formatElapsedBetween('2026-08-26T12:00:00.000Z', '2026-08-26T11:00:00.000Z', now)).toBe('0s')
  })
})
