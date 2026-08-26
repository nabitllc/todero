/**
 * TOD-2413 (bolt-time).
 *
 * Round 4 of wave 6 was told in writing that day-granularity math over an
 * hours window is the TOD-2401 fabrication and must not return "in new
 * clothes". It returned, and a critic found it only by inserting two fixture
 * rows. These tests are that fixture, made permanent.
 *
 * Every case here proves the guard FAILS when it should, not merely that it
 * passes when it should — the rule HANDOFF.md records after three rounds each
 * shipped a guard that described enforcement it did not perform.
 */

import {
  BOLT_MAX_MS,
  classifyWindow,
  formatRemaining,
  parseBoundary,
  pickHeadline,
  toBoundaryString,
  DEFAULT_BOLT_START_HOUR,
  boltWindow,
  parseStartHour,
} from '../bolt-time'

const HOUR = 3600000
const DAY = 86400000

describe('parseBoundary — the timezone the column cannot store', () => {
  it('parses a bare date as LOCAL midnight, not UTC midnight', () => {
    const d = parseBoundary('2026-08-27')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7) // August
    expect(d.getDate()).toBe(27)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })

  it('DIFFERS from the naive parse wherever the runner is not at UTC', () => {
    // This is the actual defect: `new Date('2026-08-27')` is UTC midnight, so
    // for an operator at UTC-4 the bolt reads "ended" at 8pm on the 26th.
    const naive = new Date('2026-08-27')
    const ours = parseBoundary('2026-08-27')!
    const offsetMin = ours.getTimezoneOffset()
    if (offsetMin === 0) {
      expect(ours.getTime()).toBe(naive.getTime())
    } else {
      expect(ours.getTime()).not.toBe(naive.getTime())
      expect(ours.getTime() - naive.getTime()).toBe(offsetMin * 60000)
    }
  })

  it('respects a value that already carries a time, so a TIMESTAMPTZ migration needs no change here', () => {
    const d = parseBoundary('2026-08-27T07:30:00Z')!
    expect(d.toISOString()).toBe('2026-08-27T07:30:00.000Z')
  })

  it('returns null for missing or unparseable values rather than an Invalid Date', () => {
    expect(parseBoundary(null)).toBeNull()
    expect(parseBoundary(undefined)).toBeNull()
    expect(parseBoundary('')).toBeNull()
    expect(parseBoundary('not-a-date')).toBeNull()
  })
})

describe('classifyWindow — the badge must come from the row, never a constant', () => {
  it('a missing start date is UNKNOWN and carries NO label', () => {
    // The exact round-4 fixture: no start date, end date 11 days out. It
    // rendered a hardcoded "24h" badge above "10d left".
    const c = classifyWindow(null, '2026-09-05')
    expect(c.kind).toBe('unknown')
    expect(c.windowLabel).toBeNull()
    expect(c.windowMs).toBeNull()
  })

  it('a missing end date is UNKNOWN', () => {
    expect(classifyWindow('2026-08-26', null).kind).toBe('unknown')
  })

  it('an inverted window is UNKNOWN, not a negative-length bolt', () => {
    const c = classifyWindow('2026-08-27T12:00:00Z', '2026-08-27T04:00:00Z')
    expect(c.kind).toBe('unknown')
    expect(c.windowLabel).toBeNull()
  })

  it('a real 4-hour window labels itself 4h — NOT 24h', () => {
    const c = classifyWindow('2026-08-27T00:00:00Z', '2026-08-27T04:00:00Z')
    expect(c.kind).toBe('bolt')
    expect(c.windowLabel).toBe('4h')
    expect(c.windowLabel).not.toBe('24h')
  })

  it('a real 24-hour window labels itself 24h', () => {
    const c = classifyWindow('2026-08-26', '2026-08-27')
    expect(c.kind).toBe('bolt')
    expect(c.windowLabel).toBe('24h')
  })

  it('a two-week window is a SPRINT and never renders a bolt label', () => {
    const c = classifyWindow('2026-08-13T00:00:00Z', '2026-08-27T00:00:00Z')
    expect(c.kind).toBe('sprint')
    expect(c.windowLabel).toBe('14d')
  })

  it('the bolt/sprint boundary is exactly BOLT_MAX_MS, tested from both sides', () => {
    const base = new Date('2026-08-01T00:00:00Z').getTime()
    const at = new Date(base + BOLT_MAX_MS).toISOString()
    const over = new Date(base + BOLT_MAX_MS + 60000).toISOString()
    expect(classifyWindow('2026-08-01T00:00:00Z', at).kind).toBe('bolt')
    expect(classifyWindow('2026-08-01T00:00:00Z', over).kind).toBe('sprint')
  })
})

describe('formatRemaining — TOD-2401 must not reappear', () => {
  it('never collapses hours into "0 days"', () => {
    expect(formatRemaining(9 * HOUR)).toBe('9h')
    expect(formatRemaining(9 * HOUR + 58 * 60000)).toBe('9h 58m')
    expect(formatRemaining(45 * 60000)).toBe('45m')
  })

  it('never prints "60m", and does not round a remaining time UP', () => {
    // TOD-2434. This asserted '2h' when the formatter rounded. Truncation gives
    // '1h 59m', which satisfies the rule this test exists for — never "60m" —
    // and is strictly more honest: '2h' overstated the time remaining by 1.8
    // seconds. On a countdown, rounding UP is the direction that lies.
    expect(formatRemaining(HOUR + 59.97 * 60000)).toBe('1h 59m')
    expect(formatRemaining(HOUR + 59.97 * 60000)).not.toBe('60m')
    expect(formatRemaining(HOUR + 59.97 * 60000)).not.toBe('1h 60m')
  })

  it('reports an expired window as ended, with no negative number', () => {
    expect(formatRemaining(0)).toBe('ended')
    expect(formatRemaining(-5 * HOUR)).toBe('ended')
  })

  it('only uses day units past 48h, where they are honest', () => {
    expect(formatRemaining(47 * HOUR)).toBe('47h')
    expect(formatRemaining(13 * DAY)).toBe('13d')
  })
})

describe('pickHeadline — a dead row must not hijack a live countdown', () => {
  const now = new Date('2026-08-26T12:00:00Z').getTime()
  const ended = { end_date: '2026-08-26T06:00:00Z' } // 6h ago
  const live = { end_date: '2026-08-26T20:58:00Z' } // 8h58m out

  it('picks the LIVE row when an ended row is also present', () => {
    // Round 4 reduced on remainingMs with <=; remainingMs goes negative once a
    // row expires, so the most-expired row always won. This is that case.
    const h = pickHeadline([ended, live], now)
    expect(h.state).toBe('live')
    if (h.state !== 'live') throw new Error('unreachable')
    expect(h.row).toBe(live)
    expect(formatRemaining(h.remainingMs)).toBe('8h 58m')
  })

  it('picks the live row regardless of array order', () => {
    for (const rows of [[ended, live], [live, ended]]) {
      const h = pickHeadline(rows, now)
      expect(h.state).toBe('live')
    }
  })

  it('picks the SOONEST live row among several', () => {
    const later = { end_date: '2026-08-27T20:00:00Z' }
    const h = pickHeadline([later, live, ended], now)
    if (h.state !== 'live') throw new Error('expected live')
    expect(h.row).toBe(live)
  })

  it('reports ENDED as its own state, so no caller can print "ended left"', () => {
    const h = pickHeadline([ended], now)
    expect(h.state).toBe('ended')
    // The discriminated union is the guard: there is no remainingMs to read.
    expect(h).not.toHaveProperty('remainingMs')
    if (h.state !== 'ended') throw new Error('unreachable')
    expect(formatRemaining(h.endedMsAgo)).toBe('6h')
  })

  it('picks the MOST RECENTLY ended row when every row is expired', () => {
    const older = { end_date: '2026-08-20T06:00:00Z' }
    const h = pickHeadline([older, ended], now)
    if (h.state !== 'ended') throw new Error('expected ended')
    expect(h.row).toBe(ended)
  })

  it('is "none" for no rows, and for rows that carry no end date at all', () => {
    expect(pickHeadline([], now).state).toBe('none')
    expect(pickHeadline([{ start_date: '2026-08-26' }], now).state).toBe('none')
  })

  it('ignores an end-dateless row rather than letting it outrank a live one', () => {
    const h = pickHeadline([{ start_date: '2026-08-26' }, live], now)
    expect(h.state).toBe('live')
  })
})


describe('toBoundaryString — the writer must agree with the reader', () => {
  it('round-trips: a stamped boundary parses back to the same instant', () => {
    const d = new Date(2026, 7, 25, 21, 41, 0) // local 9:41pm
    const parsed = parseBoundary(toBoundaryString(d))!
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(7)
    expect(parsed.getDate()).toBe(25) // TODAY, not tomorrow
    expect(parsed.getHours()).toBe(0)
  })

  it('DIFFERS from toISOString().split()[0] whenever local and UTC dates differ', () => {
    // The exact defect. At 21:41 in a UTC-4 zone the UTC date is already
    // tomorrow, so the writer stamped a start_date in the future.
    const d = new Date(2026, 7, 25, 21, 41, 0)
    const utcStamp = d.toISOString().split('T')[0]
    const ours = toBoundaryString(d)
    if (utcStamp !== ours) {
      expect(parseBoundary(utcStamp)!.getTime()).toBeGreaterThan(parseBoundary(ours)!.getTime())
    }
    expect(ours).toBe('2026-08-25')
  })

  it('THE INVARIANT: a bolt written now never has more remaining than its own window', () => {
    // This is the assertion that would have failed on the shipped code and
    // caught the writer/reader mismatch: a 24h bolt cannot have 26h left.
    const now = new Date(2026, 7, 25, 21, 41, 0)
    const tomorrow = new Date(now.getTime() + 86400000)

    const written = { start_date: toBoundaryString(now), end_date: toBoundaryString(tomorrow) }
    const { windowMs } = classifyWindow(written.start_date, written.end_date)
    const head = pickHeadline([written], now.getTime())
    expect(head.state).toBe('live')
    if (head.state !== 'live') throw new Error('unreachable')
    expect(windowMs).not.toBeNull()
    expect(head.remainingMs).toBeLessThanOrEqual(windowMs!)
  })

  it('the OLD writer breaks that invariant, which is why the test earns its place', () => {
    const now = new Date(2026, 7, 25, 21, 41, 0)
    const tomorrow = new Date(now.getTime() + 86400000)
    const oldWritten = {
      start_date: now.toISOString().split('T')[0],
      end_date: tomorrow.toISOString().split('T')[0],
    }
    const { windowMs } = classifyWindow(oldWritten.start_date, oldWritten.end_date)
    const head = pickHeadline([oldWritten], now.getTime())
    if (head.state !== 'live') throw new Error('expected live')
    // Only assert the break where local and UTC actually disagree at this hour.
    if (oldWritten.start_date !== toBoundaryString(now)) {
      expect(head.remainingMs).toBeGreaterThan(windowMs!)
    }
  })
})

describe('formatRemaining — "0 units left" must not reappear one unit down', () => {
  it('renders under 30 seconds as <1m, never "0m"', () => {
    expect(formatRemaining(20000)).toBe('<1m')
    expect(formatRemaining(1)).toBe('<1m')
    expect(formatRemaining(20000)).not.toBe('0m')
  })

  it('still reports a genuinely expired window as ended', () => {
    expect(formatRemaining(0)).toBe('ended')
  })
})


describe('parseStartHour — the settings table stores TEXT, so anything can arrive', () => {
  it('accepts every whole hour 0..23', () => {
    for (let h = 0; h <= 23; h++) expect(parseStartHour(String(h))).toBe(h)
  })

  it('REFUSES the values that would render a bolt opening at 25:00', () => {
    for (const bad of ['24', '25', '-1', '5.5', 'abc', '', ' ', '1e1', 'NaN', null, undefined]) {
      expect(parseStartHour(bad as string)).toBeNull()
    }
  })

  it('defaults to 5am, which is what the owner asked for', () => {
    expect(DEFAULT_BOLT_START_HOUR).toBe(5)
  })
})

describe('boltWindow — anchored to the configured hour, local', () => {
  it('a bolt opened at 5am today runs to 5am tomorrow', () => {
    const now = new Date(2026, 7, 25, 9, 0, 0) // 9am
    const { start, end } = boltWindow(5, now)
    expect(start).toBe('2026-08-25T05:00:00')
    expect(end).toBe('2026-08-26T05:00:00')
  })

  it("BEFORE the anchor hour you are inside YESTERDAY's bolt", () => {
    // The case a naive "today at 5am" gets wrong: at 4:59am it would place
    // `now` BEFORE the window it just claimed to contain, giving a negative
    // elapsed and a full countdown.
    const now = new Date(2026, 7, 25, 4, 59, 0)
    const { start, end } = boltWindow(5, now)
    expect(start).toBe('2026-08-24T05:00:00')
    expect(end).toBe('2026-08-25T05:00:00')
    expect(new Date(start).getTime()).toBeLessThanOrEqual(now.getTime())
    expect(new Date(end).getTime()).toBeGreaterThan(now.getTime())
  })

  it('THE INVARIANT: now is always inside the window, at every hour of the day', () => {
    for (let anchor = 0; anchor <= 23; anchor++) {
      for (let h = 0; h <= 23; h++) {
        const now = new Date(2026, 7, 25, h, 30, 0)
        const { start, end } = boltWindow(anchor, now)
        expect(new Date(start).getTime()).toBeLessThanOrEqual(now.getTime())
        expect(new Date(end).getTime()).toBeGreaterThan(now.getTime())
      }
    }
  })

  it('the window is always exactly 24h, and classifies as a bolt', () => {
    const { start, end } = boltWindow(5, new Date(2026, 7, 25, 9, 0, 0))
    const c = classifyWindow(start, end)
    expect(c.windowMs).toBe(86400000)
    expect(c.kind).toBe('bolt')
    expect(c.windowLabel).toBe('24h')
  })

  it('round-trips through the reader, so remaining never exceeds the window', () => {
    for (let h = 0; h <= 23; h++) {
      const now = new Date(2026, 7, 25, h, 17, 0)
      const { start, end } = boltWindow(5, now)
      const { windowMs } = classifyWindow(start, end)
      const head = pickHeadline([{ start_date: start, end_date: end }], now.getTime())
      expect(head.state).toBe('live')
      if (head.state !== 'live') throw new Error('unreachable')
      expect(head.remainingMs).toBeLessThanOrEqual(windowMs!)
    }
  })
})
