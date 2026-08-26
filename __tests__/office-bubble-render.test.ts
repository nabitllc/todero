// agent-visualization-fidelity: the "waiting on you" bubble, asserted as
// BEHAVIOUR — what the canvas is told to paint — not as source text.
//
// WHY THIS FILE EXISTS. The first revision of this lane pinned the bubble with
// `readFileSync` + `toContain`. A fresh-context critic then ran three mutations
// against the shipped code and all three survived a fully green suite:
//
//   1. delete the last argument at the draw call site  -> no bubble can EVER
//      render.                                            21/21 green.
//   2. replace that argument with the literal `1`      -> all 28 agents show a
//      fabricated "waiting on you".                       21/21 green.
//   3. delete the mirror's "remember what we published" line -> the 5s
//      re-render storm §4 claims to have fixed returns.     21/21 green.
//
// `drawAgent` was never invoked by any test in the repo. A grep proves some
// characters are present; it cannot prove the program still does the thing.
//
// So: `drawAgent` and the `drawAgents` fan-out are now DRIVEN, against a
// recording stub CanvasRenderingContext2D, and every assertion below is about
// what got painted. Mutation (1) is additionally a `tsc` error now that
// `waitingCount` has no default. Mutations (2) and (3) fail here and in
// office-board-task-mirror.test.ts respectively.
//
// This is the repair TOD-2467 already taught this repo (see app/page.tsx:512
// on lib/issue-permalink.ts): move the decision out of the component, then
// assert on what it returns.

import { drawAgent, drawAgents } from '@/components/office/officeDrawing'

// ─── A recording CanvasRenderingContext2D ────────────────────────────────────
// Node has no canvas. It does not need one: drawAgent only ever CALLS methods
// and SETS properties on the context, so a Proxy that records both is a
// faithful transcript of everything that would have been painted.

interface Call { fn: string; args: any[]; fillStyle: any; strokeStyle: any; font: any }

function recordingCtx() {
  const calls: Call[] = []
  const state: Record<string, any> = {
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 0,
    textAlign: '', globalAlpha: 1, shadowBlur: 0, shadowColor: '',
  }
  const gradient = { addColorStop() { /* recorded shape only */ } }
  const target: any = {}
  const proxy: any = new Proxy(target, {
    get(_t, prop: string) {
      if (prop in state) return state[prop]
      if (prop === '__calls') return calls
      return (...args: any[]) => {
        calls.push({
          fn: prop, args,
          fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: state.font,
        })
        if (prop === 'measureText') {
          // Proportional enough to exercise the real width maths.
          return { width: String(args[0] ?? '').length * 7 }
        }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return gradient
        return undefined
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true },
  })
  return {
    ctx: proxy as unknown as CanvasRenderingContext2D,
    calls,
    /** Every string this canvas was asked to paint. */
    texts: () => calls.filter(c => c.fn === 'fillText').map(c => String(c.args[0])),
    /** One painted string with its position and colour. */
    text: (needle: string) => {
      const c = calls.find(x => x.fn === 'fillText' && String(x.args[0]).includes(needle))
      return c ? { text: String(c.args[0]), x: c.args[1] as number, y: c.args[2] as number, fill: c.fillStyle } : null
    },
  }
}

const CAM = { x: 0, y: 0, z: 1 }
const T = 64
const NOW = 1_000_000

function agent(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'builder', name: 'Builder', emoji: '🔨', color: '#0984E3',
    px: 400, py: 300, state: 'idle', task: null, facing: 'down',
    mood: 88, active: true, animTick: 3, glowTick: 0, bobPhase: 0,
    progress: 0, tasksCompleted: 0, isOrchestrator: false,
    ...over,
  }
}

const BUBBLE = 'waiting on you'

describe('drawAgent — the bubble is painted only for a measured pending row', () => {
  it('paints NOTHING resembling a bubble when the count is 0', () => {
    const r = recordingCtx()
    drawAgent(r.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, 0)
    // The agent itself was drawn — this is a real render, not a no-op run.
    expect(r.calls.length).toBeGreaterThan(10)
    expect(r.texts().join('|')).not.toContain(BUBBLE)
  })

  it('paints "waiting on you" — with no number — for exactly one pending row', () => {
    const r = recordingCtx()
    drawAgent(r.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, 1)
    const t = r.text(BUBBLE)
    expect(t).not.toBeNull()
    // "1 waiting on you" would read as a queue of unknown length. One request
    // is stated as one request.
    expect(t!.text).toBe('waiting on you')
    expect(t!.text).not.toMatch(/\d/)
  })

  it('states the number as soon as there is more than one', () => {
    for (const n of [2, 3, 17]) {
      const r = recordingCtx()
      drawAgent(r.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, n)
      expect(r.text(BUBBLE)!.text).toBe(`${n} waiting on you`)
    }
  })

  it('never invents a count: the painted number is the count it was given', () => {
    // The critic's second mutation was a hardcoded `1`. If anything in this
    // path ever synthesized a number, these would disagree.
    for (const n of [2, 5, 9]) {
      const r = recordingCtx()
      drawAgent(r.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, n)
      expect(r.text(BUBBLE)!.text.startsWith(String(n))).toBe(true)
    }
  })

  it('draws the bubble in EVERY agent state — blocked is blocked', () => {
    // An agent stopped on a human decision is stopped whether the simulation
    // currently believes it is working, idle or walking.
    for (const state of ['idle', 'working', 'walking', 'meeting']) {
      const r = recordingCtx()
      drawAgent(r.ctx, agent({ state, task: state === 'working' ? 'a task' : null }),
        T, NOW, CAM, false, 0, {}, 0, 0, null, 1)
      expect(r.texts().join('|')).toContain(BUBBLE)
    }
  })

  it('puts the bubble ABOVE the head, and above the board-task label when there is one', () => {
    // Canvas y grows downward, so "above" is a SMALLER y. The bubble is the
    // topmost thing over the agent in both cases, or it reads as another
    // badge in the stack rather than the agent speaking.
    const a = agent({ state: 'working', task: 'refactor the mirror' })
    const bare = recordingCtx()
    drawAgent(bare.ctx, a, T, NOW, CAM, false, 0, {}, 0, 0, null, 1)
    const bubbleY = bare.text(BUBBLE)!.y
    expect(bubbleY).toBeLessThan(a.py)

    const withBoard = recordingCtx()
    drawAgent(withBoard.ctx, a, T, NOW, CAM, false, 0, { builder: 'TOD-9 board item' }, 0, 0, null, 1)
    const boardY = withBoard.text('TOD-9 board item')!.y
    const stackedBubbleY = withBoard.text(BUBBLE)!.y
    expect(stackedBubbleY).toBeLessThan(boardY)
    // …and it moved up to make room, rather than overlapping in place.
    expect(stackedBubbleY).toBeLessThan(bubbleY)
  })

  it('draws the bubble body and its tail, not just the words', () => {
    const zero = recordingCtx()
    drawAgent(zero.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, 0)
    const one = recordingCtx()
    drawAgent(one.ctx, agent(), T, NOW, CAM, false, 0, {}, 0, 0, null, 1)
    const rounded = (r: typeof zero) => r.calls.filter(c => c.fn === 'roundRect').length
    const tails = (r: typeof zero) => r.calls.filter(c => c.fn === 'closePath').length
    expect(rounded(one)).toBeGreaterThan(rounded(zero))
    expect(tails(one)).toBeGreaterThan(tails(zero))
  })
})

describe('drawAgents — the map-to-head wiring, which no test could reach before', () => {
  const roster = [
    agent({ id: 'builder', name: 'Builder', px: 100 }),
    agent({ id: 'tester', name: 'Tester', px: 300 }),
    agent({ id: 'scout', name: 'Scout', px: 500 }),
  ]
  const base = {
    T, now: NOW, cam: CAM, selectedId: null, darkAlpha: 0,
    boardTasks: {}, subagentCount: 0, runs: {},
  }

  it('gives each agent ITS OWN count and nobody else\'s', () => {
    const r = recordingCtx()
    drawAgents(r.ctx, roster, { ...base, waiting: { tester: 2 } })
    const painted = r.calls.filter(c => c.fn === 'fillText' && String(c.args[0]).includes(BUBBLE))
    expect(painted).toHaveLength(1)
    expect(painted[0].args[0]).toBe('2 waiting on you')
    // Positioned over Tester (px 300), not Builder (100) or Scout (500).
    expect(painted[0].args[1]).toBe(300)
  })

  it('paints NO bubble for anyone when the map is empty', () => {
    // This is the critic\'s mutation (2) — a hardcoded count at the call site
    // would light up all three heads here.
    const r = recordingCtx()
    drawAgents(r.ctx, roster, { ...base, waiting: {} })
    expect(r.texts().filter(t => t.includes(BUBBLE))).toHaveLength(0)
  })

  it('paints one bubble per waiting agent when several are blocked', () => {
    const r = recordingCtx()
    drawAgents(r.ctx, roster, { ...base, waiting: { builder: 1, scout: 4 } })
    const painted = r.calls
      .filter(c => c.fn === 'fillText' && String(c.args[0]).includes(BUBBLE))
      .map(c => [c.args[1], c.args[0]])
    expect(painted).toEqual([[100, 'waiting on you'], [500, '4 waiting on you']])
  })

  it('ignores a count for an id that is not on the floor, rather than misplacing it', () => {
    // partitionWaiting (officePolling.ts) is what makes this VISIBLE instead
    // of merely silent; this asserts the canvas itself never guesses a head.
    const r = recordingCtx()
    drawAgents(r.ctx, roster, { ...base, waiting: { 'lane7-critic-agent': 3 } })
    expect(r.texts().filter(t => t.includes(BUBBLE))).toHaveLength(0)
  })

  it('only the orchestrator seat is handed the subagent count', () => {
    const seen: Array<[string, number]> = []
    const withOrch = [...roster, agent({ id: 'kaos', name: 'KAOS', px: 700, isOrchestrator: true })]
    drawAgents(recordingCtx().ctx, withOrch,
      { ...base, subagentCount: 4, waiting: {} },
      ((_ctx: any, ag: any, _T: any, _now: any, _cam: any, _sel: any, _dark: any,
        _board: any, subagentCount: number) => { seen.push([ag.id, subagentCount]) }) as any)
    expect(seen).toEqual([['builder', 0], ['tester', 0], ['scout', 0], ['kaos', 4]])
  })

  it('passes each agent its own run cost and start time, and null when it has never run', () => {
    const seen: Array<[string, number, string | null]> = []
    drawAgents(recordingCtx().ctx, roster,
      { ...base, waiting: {}, runs: { tester: { estimatedCost: 1.25, startedAt: '2026-08-26T10:00:00Z' } } },
      ((_ctx: any, ag: any, _T: any, _now: any, _cam: any, _sel: any, _dark: any,
        _board: any, _sub: any, cost: number, startedAt: string | null) => {
        seen.push([ag.id, cost, startedAt])
      }) as any)
    expect(seen).toEqual([
      ['builder', 0, null],
      ['tester', 1.25, '2026-08-26T10:00:00Z'],
      ['scout', 0, null],
    ])
  })

  it('marks exactly the selected agent as selected', () => {
    const seen: Array<[string, boolean]> = []
    drawAgents(recordingCtx().ctx, roster,
      { ...base, waiting: {}, selectedId: 'scout' },
      ((_ctx: any, ag: any, _T: any, _now: any, _cam: any, isSelected: boolean) => {
        seen.push([ag.id, isSelected])
      }) as any)
    expect(seen).toEqual([['builder', false], ['tester', false], ['scout', true]])
  })
})
