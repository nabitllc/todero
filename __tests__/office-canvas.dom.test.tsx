/**
 * @jest-environment jsdom
 *
 * OfficeCanvas, mounted for real — closing the tripwire in
 * __tests__/office-wiring.test.ts ("the jsdom seam — a tripwire, not
 * coverage"). See docs/rebuild/pieces/pieces9/agent-visualization.md §9.
 *
 * WHY THIS FILE EXISTS. Everything office-wiring.test.ts covers is a pure
 * function exported from officePolling.ts / officeWiring.ts, executed
 * directly. What none of that reaches is the ~6 lines inside OfficeCanvas.tsx
 * itself that hand those functions their refs, and the effect bodies that
 * call them on a timer. Closing that gap needs an actual mount, which needed
 * jsdom + @testing-library/react — installed today. This file is the proof:
 * it renders <OfficeCanvas/>, not its source text.
 *
 * jsdom does not implement <canvas> — confirmed against this project's own
 * jsdom install before writing a line of this file:
 * `HTMLCanvasElement.prototype.getContext` throws "Not implemented" and a
 * fresh `new JSDOM(...)` returns `getContext('2d') === null`. What is
 * stubbed, and why each stub is legitimate rather than a hidden grep:
 *
 *   - `getContext('2d')` returns a Proxy that no-ops every method/property.
 *     Canvas PAINTING is not the behaviour under test below.
 *   - `components/office/officeDrawing`'s painting functions (drawFloor,
 *     drawFurniture, drawParticles, drawAgents, drawMinimap, saveMemory,
 *     createAudio, captureFrame) are replaced with jest.fn() so no real
 *     canvas call is attempted. `initAgents` is replaced with a fixture
 *     returning one agent at a KNOWN pixel position, so a synthetic click can
 *     land on it deterministically — the real function's desk-layout maths
 *     is not what this file is proving. `drawAgents` is kept observable
 *     (captured, not just no-op'd): its third argument is how this file reads
 *     `selectedIdRef`'s value without OfficeCanvas exposing that ref as a
 *     prop — see the click test below.
 *     Everything else the module exports (tileCenterPx, nowts, getDayNight,
 *     clampCam, applyCamera, countWaitingByAgent) is left REAL.
 *   - `fetchJson` (network) and `fetchAgentRuns` (Supabase, a plain `fetch`
 *     call, not `fetchJson`) are stubbed per-URL at the network boundary, so
 *     each poll effect gets a controlled answer instead of a test hitting a
 *     real server.
 *
 * None of this touches officePolling.ts or officeWiring.ts — the two files
 * that make the actual decisions — or the effect bodies inside
 * OfficeCanvas.tsx that call them. Those run for real, which is the entire
 * point of this file. See the piece doc's appendix for the mutation proof.
 */

import React from 'react'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { BOARD_TASKS_QUERY } from '@/components/office/officePolling'

// ─── officeDrawing: painting stubbed, decisions/geometry left real ──────────
const drawAgentsMock = jest.fn()
const FIXTURE_AGENT = {
  id: 'nova', name: 'Nova', emoji: '\u{1F916}', color: '#39f',
  isOrchestrator: false, active: true, state: 'idle', task: null,
  progress: 0, mood: 88, tasksCompleted: 0, taskHistory: [] as string[],
  animTick: 0, timeWorking: 0, spawning: false, spawnAge: 0,
  lastStateChange: Date.now(), glowTick: 0,
  px: 100, py: 100, deskX: 100, deskY: 100, deskTx: 0, deskTy: 0,
}

jest.mock('@/components/office/officeDrawing', () => {
  const actual = jest.requireActual('@/components/office/officeDrawing')
  return {
    ...actual,
    drawFloor: jest.fn(),
    drawFurniture: jest.fn(),
    drawParticles: jest.fn(),
    drawMinimap: jest.fn(),
    drawAgents: (...args: any[]) => drawAgentsMock(...args),
    saveMemory: jest.fn(),
    createAudio: jest.fn(() => null),
    captureFrame: jest.fn(() => ({ agents: [] })),
    initAgents: jest.fn(() => [{ ...FIXTURE_AGENT }]),
  }
})

// ─── network boundary: fetchJson ─────────────────────────────────────────────
const fetchJsonMock = jest.fn(async (url: string) => {
  if (url === BOARD_TASKS_QUERY) {
    return {
      ok: true,
      data: { data: [{ status: 'in_progress', assignee: 'nova', title: 'Fix the flaky test' }] },
    }
  }
  if (url === '/api/agents') {
    return { ok: true, data: [{ id: 'nova', name: 'Nova' }] }
  }
  return { ok: false, error: { status: 0, endpoint: url, message: 'stub — not under test' } }
})

jest.mock('@/lib/fetch-json', () => ({
  ...jest.requireActual('@/lib/fetch-json'),
  fetchJson: (...args: any[]) => (fetchJsonMock as any)(...args),
}))

// ─── network boundary: fetchAgentRuns (Supabase, not fetchJson) ─────────────
jest.mock('../hooks/useAgentStatus', () => ({
  ...jest.requireActual('../hooks/useAgentStatus'),
  fetchAgentRuns: jest.fn(async () => ({})),
}))

// eslint-disable-next-line import/first
import OfficeCanvas from '@/components/office/OfficeCanvas'

/** jsdom cannot paint. Every ctx method/property becomes a no-op — this is
 * what OfficeCanvas's own inline `ctx.clearRect(...)` call needs (the one
 * canvas call this file does not route through the mocked officeDrawing). */
function makeCtxStub() {
  return new Proxy(
    {},
    {
      get: () => () => undefined,
      set: () => true,
    },
  )
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = jest.fn(() => makeCtxStub()) as any
})

afterEach(() => {
  jest.clearAllMocks()
})

function noop() {}

function baseProps(overrides: Record<string, any>) {
  return {
    theme: 'A' as const, paused: false, soundOn: false, volume: 50,
    showMinimap: true, showDepGraph: false, showGrid: true, showLegend: true,
    simSpeed: 1, replayMode: false, isMobile: false, canvasScale: 1,
    setPaused: noop, setDetail: noop, setRoster: noop, setStats: noop,
    setWaterfall: noop, setTimeline: noop, setLeaderboard: noop,
    setReplayLen: noop, setRealTaskCounts: noop, setShowMinimap: noop,
    setShowDepGraph: noop, setReplayMode: noop, setTab: noop,
    addFeed: jest.fn(), addToast: jest.fn(),
    liveRunsRef: { current: {} },
    subagentCountRef: { current: 0 },
    subagentSessionsRef: { current: [] },
    setCtxMenu: noop,
    ...overrides,
  }
}

/**
 * Holds `selectedId` in REAL React state, the way components/AgentOffice.tsx
 * does, so a click's `setSelectedId` call is a genuine prop update — not a
 * spy reporting itself — and OfficeCanvas's own sync effect
 * (`selectedIdRef.current = selectedId`, keyed on the `selectedId` prop)
 * actually runs.
 */
function Harness(props: { boardTasksRef: any; simRef: any }) {
  const [selectedId, setSelectedIdState] = React.useState<string | null>(null)
  const setSelectedId = (v: any) =>
    setSelectedIdState(prev => (typeof v === 'function' ? v(prev) : v))
  return (
    <OfficeCanvas
      {...baseProps({})}
      boardTasksRef={props.boardTasksRef}
      simRef={props.simRef}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
    />
  )
}

describe('OfficeCanvas, mounted — the jsdom seam the tripwire asked for', () => {
  it('CONTROL: mounting produces real DOM, not a blank div', () => {
    const { container } = render(
      <Harness boardTasksRef={{ current: {} }} simRef={{ current: null }} />,
    )
    expect(container.querySelector('canvas')).toBeTruthy()
  })

  it('the board-task poll effect writes boardTasksRef, from a real fetchJson round trip', async () => {
    const boardTasksRef = { current: {} as Record<string, string> }
    render(<Harness boardTasksRef={boardTasksRef} simRef={{ current: null }} />)

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith(BOARD_TASKS_QUERY)
    })
    await waitFor(() => {
      expect(boardTasksRef.current).toEqual({ nova: 'Fix the flaky test' })
    })
  })

  it('a click on the agent sets selectedIdRef, observed at the next drawAgents call', async () => {
    const simRef = { current: null as any }
    const { container } = render(
      <Harness boardTasksRef={{ current: {} }} simRef={simRef} />,
    )

    // Wait for the roster poll (mocked /api/agents) to resolve and the
    // simulation effect's ensureAgents() to build the (mocked) agent list —
    // that is what makes simRef.current.agents and drawAgents real.
    await waitFor(() => {
      expect(simRef.current?.agents?.length).toBe(1)
    })
    await waitFor(() => {
      expect(drawAgentsMock).toHaveBeenCalled()
    })
    // Before the click: nothing is selected.
    expect(drawAgentsMock.mock.calls.at(-1)?.[2]?.selectedId).toBe(null)

    const canvas = container.querySelector('canvas')!
    // camRef starts at {x:0,y:0,z:1} (set by the resize effect), so screen
    // coordinates equal world coordinates; (100,100) is FIXTURE_AGENT's px/py.
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 })
      fireEvent.mouseUp(canvas, { clientX: 100, clientY: 100 })
    })

    await waitFor(() => {
      expect(drawAgentsMock.mock.calls.at(-1)?.[2]?.selectedId).toBe('nova')
    })
  })
})
