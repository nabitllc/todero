/**
 * components/tabs/__tests__/crew-tab-activity.test.ts — the roster's fail-closed seam.
 *
 * THE FABRICATION CLASS. GET /api/agents' `currentTask` is populated from
 * EITHER the agent's own heartbeat OR an `issues` row that merely names the
 * agent as assignee. Until 2026-08-26 those two facts arrived over the wire as
 * one nullable string, so any surface rendering it had to guess which it held
 * — and the flattering guess ("the agent is working on this") is wrong for
 * every board row in the repo. `currentTaskSource` is the fix.
 *
 * A wire field can always be absent: an older server, a proxy that drops
 * fields, a hand-rolled fixture. `activityOf()` is the exact point where
 * CrewTab decides what to believe when it is, and the only safe default is
 * 'none'. This file pins that, because the failure mode is silent — the UI
 * would look perfectly fine while asserting something nobody measured.
 *
 * There is no DOM assertion here and none is implied: this repo has no
 * testing-library, so what is tested is the pure mapping the render reads
 * from, not the pixels.
 */
import { activityOf, ceilingRefusal, type AgentsEnvelope, type RosterRowData } from '../CrewTab'
import { describeActivity } from '@/lib/fleet-liveness'

const NOW = 1_700_000_000_000

const OBSERVED_ENV = { livenessSource: 'heartbeat' } as unknown as AgentsEnvelope
const UNREADABLE_ENV = { livenessSource: 'none' } as unknown as AgentsEnvelope

function row(over: Partial<RosterRowData> = {}): RosterRowData {
  return { id: 'a', name: 'A', lastSeenAt: null, ...over } as RosterRowData
}

describe('activityOf — fails closed on task provenance', () => {
  it('treats a MISSING currentTaskSource as "none", never as the agent’s own claim', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(row({ currentTask: 'TOD-42: something' }))
    expect(input.currentTaskSource).toBe('none')
    // And the words that follow from it say there is no task, rather than
    // attributing "TOD-42" to the agent.
    expect(describeActivity(input, NOW).state).toBe('idle')
  })

  it('passes an explicit heartbeat provenance through unchanged', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(
      // `lastSeenSource` is required for the row to read as live — omitting it
      // fails closed to 'never', which is the behaviour the case above pins.
      // Spelling it out here keeps the two cases from testing the same thing.
      row({
        currentTask: 'compiling',
        currentTaskSource: 'heartbeat',
        lastSeenAt: NOW - 5_000,
        lastSeenSource: 'heartbeat',
      }),
    )
    expect(input.currentTaskSource).toBe('heartbeat')
    expect(describeActivity(input, NOW).state).toBe('working')
  })

  it('passes an explicit board provenance through unchanged, and it never reads as "working"', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(
      row({ currentTask: 'TOD-42: fix the nav', currentTaskSource: 'assigned-issue' }),
    )
    expect(input.currentTaskSource).toBe('assigned-issue')
    const d = describeActivity(input, NOW)
    expect(d.state).toBe('assigned')
    expect(d.label).not.toContain('working on')
  })
})

describe('activityOf — liveness is shared with the liveness badge, not recomputed', () => {
  it('classifies a fresh heartbeat as live', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(
      row({ lastSeenAt: NOW - 30_000, lastSeenSource: 'heartbeat' }),
    )
    expect(input.liveness).toBe('live')
  })

  it('classifies an old heartbeat as offline, so a claimed task reads stalled', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(
      row({
        lastSeenAt: NOW - 30 * 60_000,
        lastSeenSource: 'heartbeat',
        currentTask: 'TOD-42',
        currentTaskSource: 'heartbeat',
      }),
    )
    expect(input.liveness).toBe('offline')
    expect(describeActivity(input, NOW).state).toBe('stalled')
  })

  /**
   * The regression the prior work in lib/fleet-liveness.ts fixed, re-asserted
   * one layer up: a row whose only timestamp is its REGISTRATION time has not
   * checked in, and must not be treated as though it had.
   */
  it('does not accept a registration timestamp as a check-in', () => {
    const input = activityOf(OBSERVED_ENV, NOW)(
      row({ lastSeenAt: NOW - 1_000, lastSeenSource: 'registration' }),
    )
    expect(input.liveness).toBe('never')
  })

  /**
   * The store could not be read, so "it went quiet" was never observed.
   * Calling that stalled would be a claim from an absence of evidence.
   */
  it('reports unknown when the heartbeat store could not be read, and never stalls on it', () => {
    const input = activityOf(UNREADABLE_ENV, NOW)(
      row({ currentTask: 'TOD-42', currentTaskSource: 'heartbeat' }),
    )
    expect(input.liveness).toBe('unknown')
    expect(describeActivity(input, NOW).state).not.toBe('stalled')
  })

  it('prefers the row’s own livenessSource over the envelope’s', () => {
    const input = activityOf(UNREADABLE_ENV, NOW)(
      row({ livenessSource: 'heartbeat', lastSeenAt: NOW - 1_000, lastSeenSource: 'heartbeat' }),
    )
    expect(input.liveness).toBe('live')
  })
})

describe('activityOf — the remaining fields', () => {
  it('defaults a missing overCeiling to null rather than inventing a block', () => {
    expect(activityOf(OBSERVED_ENV, NOW)(row()).overCeiling).toBeNull()
  })

  it('passes a real overCeiling through, so the server’s reason reaches the screen', () => {
    const over = { ceiling: 'daily_usd', reason: 'over by $2.40' }
    const input = activityOf(OBSERVED_ENV, NOW)(row({ overCeiling: over }))
    expect(input.overCeiling).toEqual(over)
    expect(describeActivity(input, NOW).label).toContain('over by $2.40')
  })

  it('defaults a missing workStartedAt to null rather than to now', () => {
    expect(activityOf(OBSERVED_ENV, NOW)(row()).workStartedAt).toBeNull()
  })

  it('uses the now it is handed, so the two badges on one line share an instant', () => {
    // A heartbeat exactly at the 10m boundary is live; one millisecond past it
    // is offline. Passing a different `now` must move the answer, which proves
    // the parameter is threaded rather than Date.now() being read internally.
    const beat = NOW - 10 * 60_000
    const r = row({ lastSeenAt: beat, lastSeenSource: 'heartbeat' })
    expect(activityOf(OBSERVED_ENV, NOW)(r).liveness).toBe('live')
    expect(activityOf(OBSERVED_ENV, NOW + 1)(r).liveness).toBe('offline')
  })
})

/**
 * ROUND 2 — THE OFFERED-vs-REFUSED SEAM, found in this file's own component.
 *
 * CrewTab.tsx quotes design/Fleet.dc.html verbatim: "the control never appears
 * live and then refuses." It then armed the Run control from
 * `POST /api/run-agent?dryRun=1` alone — and that endpoint RETURNS at
 * app/api/run-agent/route.ts:380, sixty lines before `checkDispatchCeilings()`
 * at :440 whose refusal is the only 429 in the file. Measured live: with
 * `builder` carrying `overCeiling: { ceiling: 'concurrency_per_agent' }` in the
 * same GET /api/agents payload, the dry run still answered `wouldSpawn: true`.
 *
 * So the roster rendered a red "blocked — a dispatch would be refused right
 * now" badge next to an armed launch button, on the same line, from the same
 * payload. It was masked only by `dispatchEnabled: false` on this instance;
 * `TODERO_DISPATCH_ENABLED=1` unmasks it.
 *
 * `ceilingRefusal()` is the gate. The assertion that matters is the negative
 * one — a row carrying a ceiling must NEVER return null, because null is what
 * arms the button.
 */
describe('ceilingRefusal — the ceiling gates the Run control, not just the badge', () => {
  it('returns null only when the last roster read found no ceiling over', () => {
    expect(ceilingRefusal(row())).toBeNull()
    expect(ceilingRefusal(row({ overCeiling: null }))).toBeNull()
  })

  it('never returns null for a row the server said is over a ceiling', () => {
    const refusal = ceilingRefusal(row({ overCeiling: { ceiling: 'concurrency_per_agent', reason: '1/1 runs already in flight for builder' } }))
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('concurrency_per_agent')
    expect(refusal).toContain('1/1 runs already in flight for builder')
  })

  it('still refuses when the server reports a ceiling with no reason text', () => {
    // FAILS CLOSED: a falsy reason must not fall through to an armed control.
    expect(ceilingRefusal(row({ overCeiling: { ceiling: 'daily_usd', reason: '' } }))).not.toBeNull()
    expect(ceilingRefusal(row({ overCeiling: { ceiling: '', reason: '' } }))).not.toBeNull()
  })

  it('words it as the LAST READ, not as a prediction', () => {
    // The roster refetches every 30s and a ceiling can clear in between. The
    // control may only claim what the server actually said.
    const refusal = ceilingRefusal(row({ overCeiling: { ceiling: 'daily_usd', reason: 'over by $2.40' } }))!
    expect(refusal).toContain('as of the last roster read')
  })

  it('names the endpoint that would refuse, so the operator can check it', () => {
    const refusal = ceilingRefusal(row({ overCeiling: { ceiling: 'daily_usd', reason: 'over by $2.40' } }))!
    expect(refusal).toContain('/api/run-agent')
    expect(refusal).toContain('429')
  })

  /**
   * The badge and the control read the SAME field. If one can say "a dispatch
   * would be refused right now" while the other stays armed, the contradiction
   * is back.
   */
  it('agrees with the activity badge on the same row', () => {
    const over = { ceiling: 'concurrency_per_agent', reason: '1/1 runs already in flight' }
    const r = row({ overCeiling: over, lastSeenAt: NOW - 1_000, lastSeenSource: 'heartbeat' })
    expect(describeActivity(activityOf(OBSERVED_ENV, NOW)(r), NOW).state).toBe('blocked')
    expect(ceilingRefusal(r)).not.toBeNull()
  })
})
