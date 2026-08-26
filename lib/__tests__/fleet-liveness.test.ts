/**
 * lib/__tests__/fleet-liveness.test.ts — fleet-cards piece.
 *
 * HOW THESE TESTS ARE WRITTEN, AND WHY.
 *
 * A test that passes both before and after a change proves nothing. The old
 * behaviour these replace is not hypothetical and is not deleted — it is
 * lib/agent-liveness.ts's `classifyLiveness()`, still live, still what GET
 * /api/agents renders. So the divergence cases below assert against it
 * DIRECTLY: they import the old function, run it on the same fixture, and
 * require the two answers to differ. If lib/fleet-liveness.ts ever regresses
 * to the old windows or the old vocabulary, these fail mechanically rather
 * than by a reviewer noticing.
 *
 * The old behaviour, stated once:
 *   - `live` only under 60s              (LIVE_WINDOW_MS)
 *   - `stale` 60s to 10m, `idle` beyond  (STALE_WINDOW_MS)
 *   - `never` for a null timestamp — AND, at the GET /api/agents call site,
 *     `never` again when the heartbeat store could not be read at all, which
 *     is the collapse this piece exists to undo.
 */

import {
  OFFLINE_AFTER_MS,
  HEARTBEAT_INTERVAL_MS,
  classifyFleetLiveness,
  describeLiveness,
  formatAge,
  summarizeFleet,
  fleetProvenanceLine,
  fleetHeadline,
  type FleetLivenessInput,
} from '../fleet-liveness'
import { classifyLiveness as OLD_classifyLiveness } from '../agent-liveness'

const NOW = Date.UTC(2026, 7, 26, 3, 0, 0)
const SECOND = 1000
const MINUTE = 60_000

/** How GET /api/agents' route collapses the unreadable-store case today. */
function oldRouteLiveness(lastSeenAt: number | null, storeReadable: boolean) {
  return storeReadable ? OLD_classifyLiveness(lastSeenAt, NOW) : 'never'
}

describe('classifyFleetLiveness — the 10-minute window design/Fleet.dc.html specifies', () => {
  it('calls a 5-second-old heartbeat live (and so did the old rule — this is the case they agree on)', () => {
    const input: FleetLivenessInput = { lastSeenAt: NOW - 5 * SECOND, observed: true, source: 'heartbeat' }
    expect(classifyFleetLiveness(input, NOW)).toBe('live')
    // Documented on purpose: agreement here is what makes the DISAGREEMENTS
    // below meaningful rather than a wholesale change of vocabulary.
    expect(oldRouteLiveness(input.lastSeenAt, true)).toBe('live')
  })

  it('DIVERGES: a 5-minute-old heartbeat is live here and "stale" under the old 60s window', () => {
    const lastSeenAt = NOW - 5 * MINUTE
    expect(oldRouteLiveness(lastSeenAt, true)).toBe('stale')
    expect(classifyFleetLiveness({ lastSeenAt, observed: true, source: 'heartbeat' }, NOW)).toBe('live')
  })

  it('DIVERGES: a 15-minute-old heartbeat is offline — not live, and not the old "idle"', () => {
    const lastSeenAt = NOW - 15 * MINUTE
    expect(oldRouteLiveness(lastSeenAt, true)).toBe('idle')
    const state = classifyFleetLiveness({ lastSeenAt, observed: true, source: 'heartbeat' }, NOW)
    expect(state).toBe('offline')
    expect(state).not.toBe('live')
    expect(state).not.toBe('never')
  })

  it('holds the boundary at exactly 10 minutes: silence is offline AFTER the window, not at it', () => {
    expect(classifyFleetLiveness({ lastSeenAt: NOW - OFFLINE_AFTER_MS, observed: true, source: 'heartbeat' }, NOW)).toBe('live')
    expect(classifyFleetLiveness({ lastSeenAt: NOW - OFFLINE_AFTER_MS - 1, observed: true, source: 'heartbeat' }, NOW)).toBe('offline')
  })

  it('uses a 10-minute window and a 30-second beat, the two numbers the artboard states', () => {
    expect(OFFLINE_AFTER_MS).toBe(10 * MINUTE)
    expect(HEARTBEAT_INTERVAL_MS).toBe(30 * SECOND)
  })

  it('accepts an explicit window rather than hardcoding one into the classifier', () => {
    const lastSeenAt = NOW - 2 * MINUTE
    expect(classifyFleetLiveness({ lastSeenAt, observed: true, source: 'heartbeat' }, NOW, 60_000)).toBe('offline')
    expect(classifyFleetLiveness({ lastSeenAt, observed: true, source: 'heartbeat' }, NOW, 10 * MINUTE)).toBe('live')
  })
})

describe('never vs. unknown — the two facts the old code collapsed into one', () => {
  it('DIVERGES: an unreadable store is `unknown`, where the old route said `never`', () => {
    expect(oldRouteLiveness(null, false)).toBe('never')
    expect(classifyFleetLiveness({ lastSeenAt: null, observed: false, source: 'none' }, NOW)).toBe('unknown')
  })

  it('DIVERGES: "no agent ever checked in" and "we did not look" no longer render as the same state', () => {
    const neverChecked: FleetLivenessInput = { lastSeenAt: null, observed: true, source: 'heartbeat' }
    const notMeasured: FleetLivenessInput = { lastSeenAt: null, observed: false, source: 'none' }
    // The old route gave both the identical answer — that is the defect.
    expect(oldRouteLiveness(neverChecked.lastSeenAt, true)).toBe(
      oldRouteLiveness(notMeasured.lastSeenAt, false),
    )
    expect(classifyFleetLiveness(neverChecked, NOW)).not.toBe(classifyFleetLiveness(notMeasured, NOW))
  })

  it('DIVERGES: a real heartbeat is not erased by an unreadable store — it reports `unknown`, not the old `never`', () => {
    // `observed: false` means nothing was read, so a lastSeenAt that somehow
    // survived in a caller's stale state must not be classified from.
    expect(classifyFleetLiveness({ lastSeenAt: NOW - SECOND, observed: false, source: 'none' }, NOW)).toBe('unknown')
  })
})

describe('describeLiveness — the words, and what they must never contain', () => {
  it('DIVERGES: `never` renders no age at all, where an age was previously plausible-looking', () => {
    const d = describeLiveness({ lastSeenAt: null, observed: true, source: 'heartbeat' }, NOW)
    expect(d.state).toBe('never')
    expect(d.label).toContain('never sent a heartbeat')
    // No number anywhere: "0s ago", "1970", or any other fabricated age.
    expect(d.label).not.toMatch(/\d/)
    expect(d.label).not.toContain('ago')
  })

  it('DIVERGES: `unknown` names the STORE, never the agent, and carries no age', () => {
    const d = describeLiveness({ lastSeenAt: null, observed: false, source: 'none' }, NOW)
    expect(d.state).toBe('unknown')
    expect(d.label).toContain('heartbeat store could not be read')
    expect(d.label).not.toMatch(/\d/)
    expect(d.label).not.toContain('ago')
    // And it must not read as a claim about the agent the way `never` does.
    expect(d.label).not.toContain('never sent')
  })

  it('offline states the window it used, so the threshold is on screen not in a header comment', () => {
    const d = describeLiveness({ lastSeenAt: NOW - 15 * MINUTE, observed: true, source: 'heartbeat' }, NOW)
    expect(d.label).toBe('last heartbeat 15m ago — offline after 10m of silence')
  })

  it('live quotes the real age of the real heartbeat', () => {
    expect(describeLiveness({ lastSeenAt: NOW - 5 * SECOND, observed: true, source: 'heartbeat' }, NOW).label).toBe('heartbeat 5s ago')
  })

  it('a future timestamp is reported as clock skew, never as a negative age', () => {
    const d = describeLiveness({ lastSeenAt: NOW + 90 * SECOND, observed: true, source: 'heartbeat' }, NOW)
    expect(d.state).toBe('live')
    expect(d.label).toContain("clock disagrees")
    expect(d.label).not.toContain('-')
  })

  it('badge and state can never drift apart', () => {
    for (const input of ([
      { lastSeenAt: NOW - SECOND, observed: true, source: 'heartbeat' },
      { lastSeenAt: NOW - 30 * MINUTE, observed: true, source: 'heartbeat' },
      { lastSeenAt: null, observed: true, source: 'heartbeat' },
      { lastSeenAt: null, observed: false, source: 'none' },
    ] as FleetLivenessInput[])) {
      const d = describeLiveness(input, NOW)
      expect(d.badge).toBe(d.state)
    }
  })
})

describe('formatAge', () => {
  it('renders the artboard\'s own shapes', () => {
    expect(formatAge(4 * SECOND)).toBe('4s')
    expect(formatAge(11 * SECOND)).toBe('11s')
    expect(formatAge(15 * MINUTE)).toBe('15m')
    expect(formatAge(4 * 3600_000 + 12 * MINUTE)).toBe('4h 12m')
    expect(formatAge(26 * 3600_000)).toBe('1d 2h')
  })

  it('never renders a negative duration', () => {
    expect(formatAge(-5000)).toBe('0s')
  })
})

describe('summarizeFleet / fleetHeadline — counts, not estimates', () => {
  const rows: FleetLivenessInput[] = [
    { lastSeenAt: NOW - 5 * SECOND, observed: true, source: 'heartbeat' },   // live
    { lastSeenAt: NOW - 2 * MINUTE, observed: true, source: 'heartbeat' },   // live under the 10m window
    { lastSeenAt: NOW - 15 * MINUTE, observed: true, source: 'heartbeat' },  // offline
    { lastSeenAt: null, observed: true, source: 'heartbeat' },               // never
  ]

  it('DIVERGES: the same four rows produce 2 live under this rule and 1 under the old one', () => {
    const oldLive = rows.filter(r => oldRouteLiveness(r.lastSeenAt, r.observed) === 'live').length
    expect(oldLive).toBe(1)
    expect(summarizeFleet(rows, NOW).live).toBe(2)
  })

  it('counts every state separately and keeps the newest event', () => {
    const s = summarizeFleet(rows, NOW)
    expect(s).toMatchObject({ rows: 4, live: 2, offline: 1, never: 1, unknown: 0, anyObserved: true })
    expect(s.lastEventAt).toBe(NOW - 5 * SECOND)
  })

  it('DIVERGES: an unreadable store counts as `unknown`, not as four agents that never checked in', () => {
    const blind: FleetLivenessInput[] = rows.map(r => ({ ...r, observed: false, source: 'none' }))
    expect(blind.every(r => oldRouteLiveness(r.lastSeenAt, false) === 'never')).toBe(true)
    const s = summarizeFleet(blind, NOW)
    expect(s.unknown).toBe(4)
    expect(s.never).toBe(0)
    expect(s.lastEventAt).toBeNull()
    expect(s.anyObserved).toBe(false)
  })

  it('names only the states that actually have rows', () => {
    expect(fleetHeadline(summarizeFleet(rows, NOW))).toBe(
      '4 on the roster · 2 live · 1 offline · 1 never checked in',
    )
    expect(fleetHeadline(summarizeFleet([{ lastSeenAt: null, observed: true, source: 'heartbeat' }], NOW))).toBe(
      '1 on the roster · 1 never checked in',
    )
  })

  it('an empty fleet reports zero rows and claims nothing else', () => {
    expect(fleetHeadline(summarizeFleet([], NOW))).toBe('0 on the roster')
  })

  /**
   * ROUND 3 — THE NUMBER THAT DID NOT TRACE TO ITS QUERY.
   *
   * `fleetHeadline` opened with `"<n> registered"`, where n was the size of
   * the roster UNION. Measured live on this host 2026-08-26: GET /api/agents
   * returns 28 rows with a `rosterSource` tally of
   * `{agents-md: 14, registered: 1, vault: 13}` — so the sentence read
   * "28 registered" beside a fleet containing exactly one registration.
   *
   * `registered` is a provenance word in this lane: it means "self-registered
   * through POST /api/connect". This same module refuses to call a
   * registration timestamp a check-in (see the suite below); it may not then
   * turn around and call fourteen AGENTS.md rows and thirteen vault manifests
   * registrations.
   *
   * The guard is on the WORD, not on today's numbers, because the numbers are
   * host data and the word is the defect.
   */
  it('never opens with the provenance word "registered" for a count of all rows', () => {
    const headline = fleetHeadline(summarizeFleet(rows, NOW))
    expect(headline).not.toMatch(/\bregistered\b/)
    // And the number it does open with is the row count, from one read.
    expect(headline.startsWith(`${rows.length} `)).toBe(true)
  })
})

describe('fleetProvenanceLine — the artboard\'s most-repeated line', () => {
  it('DIVERGES: zero events says so, instead of rendering "last event 0s ago"', () => {
    const line = fleetProvenanceLine([{ lastSeenAt: null, observed: true, source: 'heartbeat' }], NOW)
    expect(line).toBe('state from hook events, never inferred · no hook event has ever arrived')
    expect(line).not.toMatch(/\d+[smhd] ago/)
  })

  it('DIVERGES: an unreadable store claims no age and says which half is missing', () => {
    const line = fleetProvenanceLine([{ lastSeenAt: null, observed: false, source: 'none' }], NOW)
    expect(line).toBe(
      'state from hook events, never inferred · the heartbeat store could not be read, so no event age is known',
    )
    expect(line).not.toMatch(/\d+[smhd] ago/)
    // And it is NOT the same sentence as the zero-events case above.
    expect(line).not.toBe(fleetProvenanceLine([{ lastSeenAt: null, observed: true, source: 'heartbeat' }], NOW))
  })

  it('states the real age of the newest event when there is one', () => {
    expect(
      fleetProvenanceLine(
        [
          { lastSeenAt: NOW - 4 * SECOND, observed: true, source: 'heartbeat' },
          { lastSeenAt: NOW - 3 * MINUTE, observed: true, source: 'heartbeat' },
          { lastSeenAt: null, observed: true, source: 'heartbeat' },
        ],
        NOW,
      ),
    ).toBe('state from hook events, never inferred · last event 4s ago')
  })
})

// ─── three-fabrications #1 ──────────────────────────────────────────────────
//
// A registration row with no recorded check-in used to inherit its
// REGISTRATION timestamp as `lastSeenAt` (lib/agent-registrations.ts's
// `toEpochMs(row.last_seen_at) ?? registeredAt`), and this module then worded
// that number as a heartbeat. MEASURED, with the heartbeat store empty and
// agent_registrations.last_seen_at NULL, the Fleet card rendered:
//
//     state from hook events, never inferred · last event 4m ago
//     Agent | live | heartbeat 4m ago
//
// Zero hook events existed. These tests are the discriminator: the ONLY thing
// that changes between the two behaviours is `source`, so a regression that
// re-collapses the provenance fails them mechanically.

describe('a registration timestamp is never worded as a hook event', () => {
  const registrationOnly = {
    lastSeenAt: NOW - 4 * MINUTE,
    observed: true,
    source: 'registration',
  } as const

  /** The SAME timestamp, sourced from the heartbeat store. The only difference. */
  const asHeartbeat = { ...registrationOnly, source: 'heartbeat' } as const

  it('is never live — the store was read and holds no check-in for this agent', () => {
    expect(classifyFleetLiveness(registrationOnly, NOW)).toBe('never')
    // The discriminator: identical timestamp, identical `observed`, different
    // provenance. The old two-field input could only ever answer 'live'.
    expect(classifyFleetLiveness(asHeartbeat, NOW)).toBe('live')
  })

  it('does NOT render "heartbeat 4m ago" — it names the registration instead', () => {
    const d = describeLiveness(registrationOnly, NOW)
    expect(describeLiveness(asHeartbeat, NOW).label).toBe('heartbeat 4m ago')
    expect(d.label).not.toContain('heartbeat 4m ago')
    expect(d.label).toContain('registered 4m ago')
    expect(d.label).toContain('no hook event')
    expect(d.badge).toBe('never')
  })

  it('contributes NO last event — the provenance line refuses the measured lie', () => {
    expect(summarizeFleet([registrationOnly], NOW).lastEventAt).toBeNull()
    expect(fleetProvenanceLine([registrationOnly], NOW)).toBe(
      'state from hook events, never inferred · no hook event has ever arrived',
    )
    // What it used to say, and what it may only say when a beat really exists:
    expect(fleetProvenanceLine([asHeartbeat], NOW)).toBe(
      'state from hook events, never inferred · last event 4m ago',
    )
  })

  it('is counted as never checked in, not as live', () => {
    const summary = summarizeFleet([registrationOnly], NOW)
    expect(summary.live).toBe(0)
    expect(summary.never).toBe(1)
    expect(fleetHeadline(summary)).toBe('1 on the roster · 1 never checked in')
  })

  it('an unread store still outranks provenance — nothing is known either way', () => {
    expect(classifyFleetLiveness({ ...registrationOnly, observed: false }, NOW)).toBe('unknown')
  })

  it('source "none" with no timestamp is the plain never, worded about the agent', () => {
    const d = describeLiveness({ lastSeenAt: null, observed: true, source: 'none' }, NOW)
    expect(d.state).toBe('never')
    expect(d.label).toContain('has never sent a heartbeat')
  })
})
