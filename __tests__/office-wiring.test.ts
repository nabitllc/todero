// agent-visualization-fidelity — the OfficeCanvas WIRING, executed.
//
// WHY THIS FILE EXISTS.
//
// A fresh-context critic ran thirty mutations against this lane's shipped
// files. Twenty-one were caught. Nine survived a fully green suite, and SEVEN
// of the nine were inside components/office/OfficeCanvas.tsx — a .tsx file
// that nothing in this repo can mount, because jest.config.js is
// `testEnvironment: "node"` and neither jsdom nor @testing-library is
// installed (checked 2026-08-26: `node_modules/jest-environment-jsdom` and
// `node_modules/jsdom` are both absent).
//
// The seven, verbatim from its report:
//
//   1. `partitionWaiting(out.waiting, roster)` -> `(out.waiting, [])`
//   2. delete `setPollError('waiting', out.error)`
//   3. delete `setPollError('tasks', out.error)`
//   4. `boardTasks:boardTasksRef.current` -> `boardTasks:{}`
//   5. `runs:liveRunsRef.current` -> `runs:{}`
//   6. `subagentCount:subagentCountRef.current` -> `subagentCount:99`
//   7. `selectedId` -> `selectedId:null`
//
// Its diagnosis of WHY was exact and worth repeating: the only thing guarding
// that layer was 18 `readFileSync` + `toContain` assertions, and a whitelist
// of hand-picked source strings can only ever catch the strings someone
// thought to list. Mutations 1, 2 and 3 changed lines ADJACENT to the pinned
// ones and passed.
//
// So the wiring moved out of the component into components/office/
// officeWiring.ts, and every test below CALLS it. Nothing here reads a source
// file. Mutations 1-6 each fail at least one assertion in this file; mutation
// 7 turned out not to be a coverage hole at all — see the last describe block.
//
// WHAT THIS FILE STILL CANNOT PROVE, said plainly rather than implied: no
// component is mounted, no frame is painted to a real canvas, and no browser
// is involved. It proves the decisions and the plumbing are correct. It does
// not prove a pixel landed. The residual is enumerated in
// docs/rebuild/pieces/pieces9/agent-visualization.md §6.

import type { ApiError } from '@/lib/fetch-json'
import {
  applyBoardTaskOutcome, applyWaitingOutcome, applyRosterOutcome,
  rosterIdsFromSim, drawOptionsFromRefs, emptyLiveness, bubbleHit, inboxHrefFromPath,
  type Cell, type OfficeDrawRefs,
} from '@/components/office/officeWiring'
import { boardTaskPollOutcome, waitingPollOutcome } from '@/components/office/officePolling'
import {
  livenessFromAgentsBody, livenessPip, livenessContradiction, livenessHonestyLine,
  LIVENESS_COLOR,
} from '@/components/office/officeLiveness'
import { showsBoardTask } from '@/components/office/officeDrawing'

const ERR: ApiError = { status: 500, endpoint: '/api/x', message: 'boom' }

/** A ref, structurally — the real functions take `{current}` and nothing more. */
function cell<T>(v: T): Cell<T> { return { current: v } }

/** Records every (key, error) pair the code under test raised or cleared. */
function errorSink() {
  const calls: Array<[string, ApiError | null]> = []
  return {
    set: (k: string, e: ApiError | null) => { calls.push([k, e]) },
    calls,
    keys: () => calls.map(c => c[0]),
    for: (k: string) => calls.filter(c => c[0] === k).map(c => c[1]),
  }
}

function feedSink() {
  const lines: string[] = []
  return { add: (t: string, _c?: string) => { lines.push(t) }, lines }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('applyBoardTaskOutcome — the banner and the board move together', () => {
  it('a readable answer fills the map AND clears the banner', () => {
    const ref = cell<Record<string, string>>({})
    const e = errorSink()
    applyBoardTaskOutcome(
      boardTaskPollOutcome({ ok: true, data: { data: [{ status: 'in_progress', assignee: 'builder', title: 'TOD-9' }] } }),
      ref, e.set,
    )
    expect(ref.current).toEqual({ builder: 'TOD-9' })
    expect(e.for('tasks')).toEqual([null])
  })

  // MUTATION 3. Deleting the `setPollError('tasks', …)` line meant a failed
  // /api/issues emptied nothing and said nothing — the desks kept their last
  // labels and no banner ever appeared, so a dead poll looked like a quiet
  // office. This is the assertion that fails now.
  it('a FAILED request raises the banner and does NOT empty the desks', () => {
    const ref = cell<Record<string, string>>({ builder: 'TOD-9' })
    const e = errorSink()
    applyBoardTaskOutcome(boardTaskPollOutcome({ ok: false, error: ERR }), ref, e.set)
    expect(e.for('tasks')).toEqual([ERR])
    expect(ref.current).toEqual({ builder: 'TOD-9' })
  })

  it('an unreadable BODY also keeps the last board, and raises no banner — it was a real 200', () => {
    const ref = cell<Record<string, string>>({ builder: 'TOD-9' })
    const e = errorSink()
    applyBoardTaskOutcome(boardTaskPollOutcome({ ok: true, data: { nope: true } }), ref, e.set)
    expect(ref.current).toEqual({ builder: 'TOD-9' })
    expect(e.for('tasks')).toEqual([null])
  })

  it('raises the banner on EVERY failed poll, not only the first', () => {
    const ref = cell<Record<string, string>>({})
    const e = errorSink()
    for (let i = 0; i < 3; i++) applyBoardTaskOutcome(boardTaskPollOutcome({ ok: false, error: ERR }), ref, e.set)
    expect(e.for('tasks')).toEqual([ERR, ERR, ERR])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('rosterIdsFromSim — the ids a bubble can actually be drawn over', () => {
  it('reads the figures on the floor', () => {
    expect(rosterIdsFromSim({ agents: [{ id: 'builder' }, { id: 'tester' }] })).toEqual(['builder', 'tester'])
  })
  it('an unbuilt simulation is an empty floor, not a crash', () => {
    expect(rosterIdsFromSim(null)).toEqual([])
    expect(rosterIdsFromSim(undefined)).toEqual([])
    expect(rosterIdsFromSim({})).toEqual([])
    expect(rosterIdsFromSim({ agents: 'nope' as any })).toEqual([])
  })
  it('skips a figure with no id rather than inventing one', () => {
    expect(rosterIdsFromSim({ agents: [{ id: 'builder' }, {}, { id: '' }, { id: 7 }] })).toEqual(['builder'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('applyWaitingOutcome — bubbles, banner and feed line from one call', () => {
  const sim = { agents: [{ id: 'builder' }, { id: 'tester' }] }
  const pending = (agent: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${agent}-${i}`, agent, status: 'pending' }))

  // MUTATION 1, the headline. Passing `[]` as the roster classifies EVERY
  // waiting agent as off-roster, so `waitingRef.current` is permanently empty
  // and no speech bubble can ever render for anyone — the entire feature this
  // channel is judged on, dead, with 77/77 green. The roster now comes from
  // `rosterIdsFromSim(sim)` INSIDE the function, and this test drives a real
  // sim through it.
  it('a pending row for an agent ON the floor becomes a drawable count', () => {
    const waitingRef = cell<Record<string, number>>({})
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    const out = applyWaitingOutcome(
      waitingPollOutcome({ ok: true, data: pending('builder', 2) }),
      sim, waitingRef, last, e.set, f.add,
    )
    expect(waitingRef.current).toEqual({ builder: 2 })
    expect(out.drawable).toEqual({ builder: 2 })
    expect(out.unroutedIds).toEqual([])
    expect(f.lines).toEqual([])
    expect(e.for('waiting')).toEqual([null])
  })

  it('an EMPTY floor makes every row unroutable — which is the mutation-1 shape, and it is loud', () => {
    const waitingRef = cell<Record<string, number>>({})
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    const out = applyWaitingOutcome(
      waitingPollOutcome({ ok: true, data: pending('builder', 2) }),
      { agents: [] }, waitingRef, last, e.set, f.add,
    )
    expect(waitingRef.current).toEqual({})
    expect(out.unroutedIds).toEqual(['builder'])
    // The point: bubbles vanishing is never silent. If the floor cannot hold
    // the row, the feed says so.
    expect(f.lines.join('')).toContain('waiting on you')
  })

  // MUTATION 2. Deleting `setPollError('waiting', …)` left `waiting:{}` from a
  // failed poll — every bubble gone, no banner — which is a confident, silent
  // "nobody is waiting" over a question that was never answered. This asserts
  // both halves from one call, so they cannot be separated by a refactor.
  it('a FAILED poll drops every bubble AND raises the banner', () => {
    const waitingRef = cell<Record<string, number>>({ builder: 3 })
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    applyWaitingOutcome(waitingPollOutcome({ ok: false, error: ERR }), sim, waitingRef, last, e.set, f.add)
    expect(waitingRef.current).toEqual({})
    expect(e.for('waiting')).toEqual([ERR])
  })

  it('an off-roster row is counted, reported once, and NOT repeated every poll', () => {
    const waitingRef = cell<Record<string, number>>({})
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    const poll = () => applyWaitingOutcome(
      waitingPollOutcome({ ok: true, data: pending('critic-probe', 2) }),
      sim, waitingRef, last, e.set, f.add,
    )
    const first = poll()
    poll(); poll()
    expect(first.unroutedIds).toEqual(['critic-probe'])
    expect(first.unroutedRows).toBe(2)
    // Three polls, ONE feed line. A 60s poll repeating one sentence a minute
    // trains the operator to ignore the feed.
    expect(f.lines).toHaveLength(1)
    expect(f.lines[0]).toContain('critic-probe')
    expect(f.lines[0]).toContain('2 requests are')
  })

  it('says it again once the sentence CHANGES', () => {
    const waitingRef = cell<Record<string, number>>({})
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    applyWaitingOutcome(waitingPollOutcome({ ok: true, data: pending('ghost', 1) }), sim, waitingRef, last, e.set, f.add)
    applyWaitingOutcome(waitingPollOutcome({ ok: true, data: pending('ghost', 4) }), sim, waitingRef, last, e.set, f.add)
    expect(f.lines).toHaveLength(2)
    expect(f.lines[0]).toContain('1 request is')
    expect(f.lines[1]).toContain('4 requests are')
  })

  it('a floor that goes quiet clears the remembered sentence, so it can be said again later', () => {
    const waitingRef = cell<Record<string, number>>({})
    const last = cell<string | null>(null)
    const e = errorSink(); const f = feedSink()
    applyWaitingOutcome(waitingPollOutcome({ ok: true, data: pending('ghost', 1) }), sim, waitingRef, last, e.set, f.add)
    applyWaitingOutcome(waitingPollOutcome({ ok: true, data: [] }), sim, waitingRef, last, e.set, f.add)
    applyWaitingOutcome(waitingPollOutcome({ ok: true, data: pending('ghost', 1) }), sim, waitingRef, last, e.set, f.add)
    expect(f.lines).toHaveLength(2)
    expect(last.current).not.toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('applyRosterOutcome — one /api/agents body feeds the floor AND the heartbeats', () => {
  // The shape measured live on 2026-08-26 against the running dev server:
  //   envelope livenessSource:"heartbeat", heartbeatStore:"agent_heartbeats"
  //   rows: {id, lastSeenAt, lastSeenSource, liveness, …}
  const NOW = 1_700_000_000_000
  const body = {
    livenessSource: 'heartbeat',
    agents: [
      { id: 'agent', lastSeenAt: NOW - 4_000, lastSeenSource: 'heartbeat' },
      { id: 'builder', lastSeenAt: null, lastSeenSource: 'none' },
      { id: 'tester', lastSeenAt: NOW - 3_600_000, lastSeenSource: 'heartbeat' },
    ],
  }

  it('fills the roster ref and the liveness ref from the SAME answer', () => {
    const rosterRef = cell<any[] | null>(null)
    const livenessRef = cell(emptyLiveness())
    const out = applyRosterOutcome(body, rosterRef, livenessRef, NOW)
    expect(rosterRef.current).toHaveLength(3)
    expect(out.state).toBe('ready')
    expect(livenessRef.current.byId.agent.state).toBe('live')
    expect(livenessRef.current.byId.builder.state).toBe('never')
    expect(livenessRef.current.byId.tester.state).toBe('offline')
    expect(livenessRef.current.counts).toEqual({ live: 1, offline: 1, never: 1, unknown: 0 })
  })

  it('zero agents is an EARNED "empty", not a fabricated cast', () => {
    const rosterRef = cell<any[] | null>([{ id: 'stale' }])
    const livenessRef = cell(emptyLiveness())
    const out = applyRosterOutcome({ livenessSource: 'heartbeat', agents: [] }, rosterRef, livenessRef, NOW)
    expect(out.state).toBe('empty')
    expect(rosterRef.current).toEqual([])
    expect(out.liveness.total).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('officeLiveness — the Office classifies through lib/fleet-liveness, not its own rule', () => {
  const NOW = 1_700_000_000_000

  it('an UNREAD store is `unknown` for every row — never `never`', () => {
    // This is the distinction the whole module exists for. "No agent has ever
    // checked in" and "we did not look" are different facts, and rendering the
    // second as the first is a claim made from an absence of evidence.
    const r = livenessFromAgentsBody(
      { livenessSource: 'none', agents: [{ id: 'builder', lastSeenAt: null, lastSeenSource: 'none' }] }, NOW)
    expect(r.observed).toBe(false)
    expect(r.byId.builder.state).toBe('unknown')
    expect(r.byId.builder.label).not.toMatch(/\d/)
  })

  it('a BARE ARRAY body carries no envelope, so nothing is known — also `unknown`', () => {
    const r = livenessFromAgentsBody([{ id: 'builder', lastSeenAt: NOW, lastSeenSource: 'heartbeat' }], NOW)
    expect(r.observed).toBe(false)
    expect(r.byId.builder.state).toBe('unknown')
  })

  it('a REGISTRATION timestamp is not a heartbeat, and is not counted as one', () => {
    const r = livenessFromAgentsBody(
      { livenessSource: 'heartbeat', agents: [{ id: 'builder', lastSeenAt: NOW, lastSeenSource: 'registration' }] }, NOW)
    expect(r.byId.builder.state).toBe('never')
    expect(r.byId.builder.lastSeenAt).toBeNull()
  })

  it('the 10-minute window is lib/fleet-liveness.ts\'s, applied at both edges', () => {
    const at = (age: number) => livenessFromAgentsBody(
      { livenessSource: 'heartbeat', agents: [{ id: 'a', lastSeenAt: NOW - age, lastSeenSource: 'heartbeat' }] }, NOW,
    ).byId.a.state
    expect(at(10 * 60_000)).toBe('live')
    expect(at(10 * 60_000 + 1)).toBe('offline')
  })

  it('only a LIVE row carries an age forward to the canvas', () => {
    const r = livenessFromAgentsBody({
      livenessSource: 'heartbeat',
      agents: [
        { id: 'a', lastSeenAt: NOW - 1000, lastSeenSource: 'heartbeat' },
        { id: 'b', lastSeenAt: NOW - 86_400_000, lastSeenSource: 'heartbeat' },
      ],
    }, NOW)
    expect(r.byId.a.lastSeenAt).toBe(NOW - 1000)
    // An `offline` row HAS a timestamp; carrying it to the pip is how "14h"
    // gets painted beside a silent agent and reads as activity.
    expect(r.byId.b.lastSeenAt).toBeNull()
  })

  it('the pip is a duration ONLY for live; the other three are words', () => {
    const mk = (state: any, lastSeenAt: number | null) => ({ state, lastSeenAt, label: '', source: 'none' as const })
    expect(livenessPip(mk('live', NOW - 4000), NOW)).toBe('4s')
    expect(livenessPip(mk('offline', null), NOW)).toBe('offline')
    expect(livenessPip(mk('never', null), NOW)).toBe('no beat')
    expect(livenessPip(mk('unknown', null), NOW)).toBe('?')
    expect(livenessPip(null, NOW)).toBe('?')
  })

  it('never and unknown are not painted green', () => {
    expect(LIVENESS_COLOR.never).not.toBe(LIVENESS_COLOR.live)
    expect(LIVENESS_COLOR.unknown).not.toBe(LIVENESS_COLOR.live)
    expect(LIVENESS_COLOR.offline).not.toBe(LIVENESS_COLOR.live)
  })

  describe('livenessContradiction — the two-surfaces disagreement, named', () => {
    const l = (state: any) => ({ state, lastSeenAt: null, label: '', source: 'none' as const })
    it('working + no heartbeat ever is a contradiction, and names both sides', () => {
      const m = livenessContradiction('working', l('never'))
      expect(m).toContain('working')
      expect(m).toContain('heartbeat')
    })
    it('working + offline and working + unreadable store are distinct sentences', () => {
      expect(livenessContradiction('working', l('offline')))
        .not.toBe(livenessContradiction('working', l('unknown')))
    })
    it('working + live is NOT a contradiction', () => {
      expect(livenessContradiction('working', l('live'))).toBeNull()
    })
    it('an idle or walking figure claims nothing, so it cannot contradict anything', () => {
      for (const s of ['idle', 'walking', 'meeting', null, undefined]) {
        expect(livenessContradiction(s, l('never'))).toBeNull()
      }
    })
  })

  describe('livenessHonestyLine — self-correcting from the real counts', () => {
    it('an unread store is described as an unread STORE, with no agent claim', () => {
      const line = livenessHonestyLine({ ...emptyLiveness(), total: 28, counts: { live: 0, offline: 0, never: 0, unknown: 28 } })
      expect(line).toContain('heartbeat store')
      expect(line).not.toContain('never')
    })
    it('zero live out of many says the figures come from agent_runs, and names the number', () => {
      const line = livenessHonestyLine({ byId: {}, observed: true, total: 28, counts: { live: 0, offline: 0, never: 28, unknown: 0 } })
      expect(line).toContain('0 of 28')
      expect(line).toContain('agent_runs')
    })
    it('the wording changes on its own when the store starts answering', () => {
      const a = livenessHonestyLine({ byId: {}, observed: true, total: 28, counts: { live: 0, offline: 0, never: 28, unknown: 0 } })
      const b = livenessHonestyLine({ byId: {}, observed: true, total: 28, counts: { live: 1, offline: 0, never: 27, unknown: 0 } })
      expect(b).not.toBe(a)
      expect(b).toContain('1 of 28')
    })
    it('an empty roster is not reported as a heartbeat failure', () => {
      expect(livenessHonestyLine({ byId: {}, observed: true, total: 0, counts: { live: 0, offline: 0, never: 0, unknown: 0 } }))
        .toContain('0 agents')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('showsBoardTask — ONE copy of the rule the label and the bubble both need', () => {
  // MUTATION 8. `if(boardTask&&(state==="working"||state==="idle"))` ->
  // `if(boardTask)` unpinned the state gate, so the label painted over walking
  // and in-meeting figures while the speech bubble's stacking maths — a SECOND
  // copy of the same condition, at officeDrawing.ts:560 — still assumed it was
  // absent. Two copies of one rule is what made that possible.
  it('paints for a figure at its desk', () => {
    expect(showsBoardTask('TOD-9', 'working')).toBe(true)
    expect(showsBoardTask('TOD-9', 'idle')).toBe(true)
  })
  it('does NOT paint for a figure crossing the floor or in a meeting', () => {
    expect(showsBoardTask('TOD-9', 'walking')).toBe(false)
    expect(showsBoardTask('TOD-9', 'meeting')).toBe(false)
  })
  it('no board row, no label, whatever the figure is doing', () => {
    for (const s of ['working', 'idle', 'walking', 'meeting']) {
      expect(showsBoardTask(null, s)).toBe(false)
      expect(showsBoardTask('', s)).toBe(false)
      expect(showsBoardTask(undefined, s)).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('drawOptionsFromRefs — the object literal that four mutants lived in', () => {
  // MUTATIONS 4, 5, 6. Each replaced one property of the drawAgents options
  // literal with junk — `boardTasks:{}`, `runs:{}`, `subagentCount:99` — and
  // survived 77/77 because the literal was inside the .tsx. There is no
  // literal any more. Every property below is asserted against a value only
  // its own ref could have produced.
  const refs: OfficeDrawRefs = {
    boardTasksRef: { current: { builder: 'TOD-9 the board row' } },
    subagentCountRef: { current: 7 },
    liveRunsRef: { current: { builder: { estimatedCost: 1.25, startedAt: '2026-08-26T00:00:00Z' } as any } },
    waitingRef: { current: { builder: 3 } },
    livenessRef: { current: { ...emptyLiveness(), byId: { builder: { state: 'live', label: 'heartbeat 4s ago', lastSeenAt: 1, source: 'heartbeat' } } } },
    selectedIdRef: { current: 'builder' },
  }
  const frame = { T: 64, now: 1_000_000, cam: { x: 0, y: 0, z: 1 }, darkAlpha: 0.25 }

  it('every property traces to its OWN ref, and none is empty or invented', () => {
    const o = drawOptionsFromRefs(refs, frame)
    expect(o.boardTasks).toEqual({ builder: 'TOD-9 the board row' })
    expect(o.subagentCount).toBe(7)
    expect(o.runs.builder!.estimatedCost).toBe(1.25)
    expect(o.waiting).toEqual({ builder: 3 })
    expect(o.liveness.builder.state).toBe('live')
    expect(o.selectedId).toBe('builder')
  })

  it('the per-frame values are the frame\'s, not a ref\'s', () => {
    const o = drawOptionsFromRefs(refs, frame)
    expect(o.T).toBe(64)
    expect(o.now).toBe(1_000_000)
    expect(o.darkAlpha).toBe(0.25)
    expect(o.cam).toBe(frame.cam)
  })

  it('re-reads `.current` every call — a frame drawn after a poll sees the new value', () => {
    // This is what makes the indirection correct rather than merely tidy: the
    // draw loop runs at 60fps and the polls write to these refs on a 60s
    // timer. Snapshotting at build time would freeze the office at mount.
    const live: OfficeDrawRefs = { ...refs, boardTasksRef: { current: {} }, waitingRef: { current: {} } }
    expect(drawOptionsFromRefs(live, frame).boardTasks).toEqual({})
    live.boardTasksRef.current = { tester: 'TOD-10' }
    live.waitingRef.current = { tester: 1 }
    const after = drawOptionsFromRefs(live, frame)
    expect(after.boardTasks).toEqual({ tester: 'TOD-10' })
    expect(after.waiting).toEqual({ tester: 1 })
  })

  // MUTATION 7, and the correction to it. The critic planted
  // `selectedId -> selectedId:null` and reported it as a survivor. It survived
  // because it was a NO-OP: `selectedId` was read from props inside the
  // simulation effect, whose dependency array is `[addFeed,addToast]`, and
  // components/AgentOffice.tsx:37-44 defines both with `useCallback(…, [])`.
  // The effect therefore runs once, at mount, and froze `selectedId` at
  // `useState<string|null>(null)`'s initial `null` — permanently. Clicking an
  // agent updated the parent's state and highlighted nothing. That was a live
  // defect, not a coverage hole, and the fix is the ref this asserts.
  it('selection comes from a ref, so a click after mount actually reaches the frame', () => {
    const r: OfficeDrawRefs = { ...refs, selectedIdRef: { current: null } }
    expect(drawOptionsFromRefs(r, frame).selectedId).toBeNull()
    r.selectedIdRef.current = 'tester'
    expect(drawOptionsFromRefs(r, frame).selectedId).toBe('tester')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
describe('the bubble is a door — the actionability the benchmark has and we did not', () => {
  // Measured as a loss against the benchmark: their "waiting on you" bubble is
  // a live prompt; ours was a read-only sticker on a surface whose entire claim
  // is that a HUMAN must answer before the agent moves. The destination pair
  // (`now`, `inbox`) is read from components/nav/config.ts's LEGACY_TAB_MAP,
  // not guessed, and both resulting URLs were checked live on 2026-08-26
  // against the running dev server: /now/inbox -> 200, /p/limiglow/now/inbox
  // -> 200.
  describe('inboxHrefFromPath', () => {
    it('keeps the operator inside the project they were working in', () => {
      expect(inboxHrefFromPath('/p/limiglow/fleet/office')).toBe('/p/limiglow/now/inbox')
    })
    it('answers the fleet-wide inbox from the bare office URL', () => {
      expect(inboxHrefFromPath('/fleet/office')).toBe('/now/inbox')
    })
    it('is not confused by a trailing slash or the root', () => {
      expect(inboxHrefFromPath('/fleet/office/')).toBe('/now/inbox')
      expect(inboxHrefFromPath('/')).toBe('/now/inbox')
      expect(inboxHrefFromPath('')).toBe('/now/inbox')
    })
    it('does not invent a project from a path that only starts with p', () => {
      expect(inboxHrefFromPath('/people/office')).toBe('/now/inbox')
      expect(inboxHrefFromPath('/p')).toBe('/now/inbox')
    })
  })

  describe('bubbleHit', () => {
    const T = 64
    const a = { px: 400, py: 300 }
    const hs = (T * 0.58) / 2

    it('a click in the bubble band above a waiting agent opens the door', () => {
      expect(bubbleHit({ x: 400, y: 300 - hs - T * 0.6 }, a, 1, T)).toBe(true)
    })

    it('an agent with NO pending row has no hot-spot at all', () => {
      // The whole point. A hidden click target over an agent that is not
      // waiting would be a fabricated affordance — the same defect as a
      // fabricated count, in a different medium.
      expect(bubbleHit({ x: 400, y: 300 - hs - T * 0.6 }, a, 0, T)).toBe(false)
      expect(bubbleHit({ x: 400, y: 300 - hs - T * 0.6 }, a, -1, T)).toBe(false)
    })

    it('a click ON the figure still selects the figure', () => {
      expect(bubbleHit({ x: 400, y: 300 }, a, 3, T)).toBe(false)
    })

    it('a click on the empty floor beside the agent is not the bubble', () => {
      expect(bubbleHit({ x: 400 + T * 3, y: 300 - hs - T * 0.6 }, a, 3, T)).toBe(false)
    })

    it('a click well above the bubble is not the bubble either', () => {
      expect(bubbleHit({ x: 400, y: 300 - hs - T * 4 }, a, 3, T)).toBe(false)
    })

    it('the orchestrator has a bigger head, and the band sits above it', () => {
      const orch = { px: 400, py: 300, isOrchestrator: true }
      const ohs = (T * 0.78) / 2
      expect(bubbleHit({ x: 400, y: 300 - ohs - T * 0.6 }, orch, 1, T)).toBe(true)
      // …and the band does not reach down onto the larger head itself.
      expect(bubbleHit({ x: 400, y: 300 - ohs + T * 0.05 }, orch, 1, T)).toBe(false)
    })

    it('scales with the tile size, so it stays over the bubble at any zoom', () => {
      for (const t of [24, 64, 120]) {
        const h = (t * 0.58) / 2
        expect(bubbleHit({ x: 400, y: 300 - h - t * 0.6 }, a, 1, t)).toBe(true)
        expect(bubbleHit({ x: 400, y: 300 - h - t * 4 }, a, 1, t)).toBe(false)
      }
    })
  })
})

// -----------------------------------------------------------------------------
describe('the jsdom seam — a tripwire, not coverage', () => {
  // Everything above executes real functions. What none of it does is MOUNT
  // OfficeCanvas, so the ~6 remaining lines that hand these functions their
  // refs are still unexecuted. Closing that needs jsdom, which is a
  // package.json + jest.config.js change this lane does not own. The exact
  // diff is docs/rebuild/pieces/pieces9/agent-visualization.md §9.
  //
  // This test does not pretend to be that coverage. It is a tripwire: the day
  // someone lands the seam, it FAILS, with the next step in its message —
  // so the dependency cannot arrive without the migration being noticed.
  it('fails the moment jsdom lands, so the DOM suite is not forgotten', () => {
    let present = false
    try { require.resolve('jest-environment-jsdom'); present = true } catch { present = false }
    expect({
      jsdomInstalled: present,
      nextStep: present
        ? 'jsdom is now installed. Add __tests__/office-canvas.dom.test.tsx with @jest-environment jsdom, mount OfficeCanvas with stub refs, and assert the poll effects write the refs and the click sets selectedIdRef — then delete this tripwire. See pieces9/agent-visualization.md §9.'
        : 'not installed; nothing to migrate yet',
    }).toEqual({ jsdomInstalled: false, nextStep: 'not installed; nothing to migrate yet' })
  })
})
