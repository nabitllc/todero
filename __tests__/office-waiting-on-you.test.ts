// agent-visualization-fidelity: the Office's "waiting on you" speech bubble.
//
// WHAT MAKES THE BUBBLE HONEST, and what these tests actually pin down.
//
// The competitor benchmark (pixel-agents) shows a speech bubble when an agent
// is waiting on a human. The temptation is to synthesize that state — bubble
// the agents that "look" idle, or that have been idle a while. This app has a
// REAL state for it and the bubble is drawn from that and nothing else: an
// `inbox` row with status='pending'. lib/approvals.ts describes such a row in
// exactly those words ("… and it is waiting on you.") and says a refusal
// "leaves it stopped" — so a pending row is a BLOCKED AGENT, not a
// notification, which is precisely what a bubble over its head should mean.
//
// SCOPE OF THIS FILE, after the critic pass. This file owns ONE thing: the
// counting rule, `countWaitingByAgent`. It used to also carry six
// `readFileSync` + `toContain` assertions claiming to guard the wiring and the
// render; all six survived deleting the feature at the call site, and all six
// survived replacing the count with a fabricated literal. They are gone. What
// they claimed to guard is now asserted by running the code:
//
//   __tests__/office-bubble-render.test.ts  — drives drawAgent/drawAgents
//                                             against a recording canvas.
//   __tests__/office-polling.test.ts        — runs the poll decisions,
//                                             including the failure branch.
//
import { countWaitingByAgent } from '@/components/office/officeHelpers'

describe('countWaitingByAgent — the only thing a bubble is allowed to come from', () => {
  it('counts one pending row per agent', () => {
    expect(countWaitingByAgent([{ agent: 'builder' }])).toEqual({ builder: 1 })
  })

  it('accumulates several rows for the same agent', () => {
    expect(countWaitingByAgent([
      { agent: 'builder' }, { agent: 'builder' }, { agent: 'tester' },
    ])).toEqual({ builder: 2, tester: 1 })
  })

  it('falls back to context.agent_id — the same order lib/approvals.ts:approvalTarget() resolves', () => {
    // A decision acts on `row.agent` first, then `context.agent_id`. If this
    // surface resolved it the other way round, the bubble could sit over an
    // agent that pressing the button would not actually unblock.
    expect(countWaitingByAgent([{ context: { agent_id: 'scout' } }])).toEqual({ scout: 1 })
    expect(countWaitingByAgent([{ agent: 'ops', context: { agent_id: 'scout' } }])).toEqual({ ops: 1 })
  })

  it('counts a row that names no agent FOR NOBODY, rather than bucketing it under a placeholder', () => {
    // The row still needs a human and is still visible in the real inbox —
    // but this surface cannot say whose head to draw it over, and inventing
    // an owner is the fabrication the Office exists to avoid.
    expect(countWaitingByAgent([{ type: 'orphan' }, { agent: '   ' }, { agent: 42 }])).toEqual({})
  })

  it('returns {} — never throws — for a non-array body', () => {
    // /api/inbox answers a BARE ARRAY unscoped and {data,…} when project= is
    // given. The Office asks unscoped, but a shape change must degrade to
    // "no bubbles", not to a crashed render loop.
    for (const bad of [null, undefined, {}, { data: [{ agent: 'builder' }] }, 'nope', 0]) {
      expect(countWaitingByAgent(bad as unknown)).toEqual({})
    }
  })

  it('does not re-filter by status — the caller must pass only pending rows', () => {
    // Documented deliberately: a caller that forgets the filter shows TOO
    // MANY bubbles (loud, noticed immediately) rather than being silently
    // rescued into a wrong-but-plausible number.
    expect(countWaitingByAgent([{ agent: 'builder', status: 'approved' }])).toEqual({ builder: 1 })
  })
})

describe('the bubble is wired to real state, and only real state', () => {
  it('is asserted by execution, not by grep — see the two suites named above', () => {
    // Kept as a signpost rather than a deleted section: the six string-match
    // assertions that used to live here are the ones a critic proved worthless
    // by deleting the feature under them. Anyone adding a "quick toContain
    // guard" for this surface should add an executing test instead.
    expect(require('fs').existsSync(
      require('path').join(__dirname, 'office-bubble-render.test.ts'))).toBe(true)
    expect(require('fs').existsSync(
      require('path').join(__dirname, 'office-polling.test.ts'))).toBe(true)
  })
})
