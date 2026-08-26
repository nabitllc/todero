// agent-visualization-fidelity: the boardTasks mirror.
//
// BACKGROUND. Two Office pollers both asked "what is each agent working on?"
// against '/api/tasks' — OfficeCanvas.tsx on 60s and useAgentStatus.ts on 30s,
// writing into the SAME boardTasksRef. Every request 404'd. The reason is not
// "someone invented a route": commit fd7e5b5 ("refactor: tasks → issues")
// RENAMED app/api/{tasks => issues}/route.ts, and these two callers were the
// stragglers it missed. The repair is to follow the rename, which is why the
// remaining fetch targets /api/issues and why NO app/api/tasks route was
// built: rebuilding it would resurrect the exact name that rename retired.
//
// THIS FILE guards the second half of that fix — the mirror. useAgentStatus no
// longer fetches at all; it publishes OfficeCanvas's ref into React state. Done
// naively (`setBoardTasks({...ref.current})` every tick) that hands React a NEW
// OBJECT IDENTITY on every tick, re-rendering AgentOffice — and OfficeCanvas,
// which drives requestAnimationFrame loops — 12× per minute on a completely
// idle office whose data only changes once every 60s.
//
// WHAT CHANGED IN THIS REVISION, and why. Every assertion here used to be
// `readFileSync` + `toContain` against hooks/useAgentStatus.ts. A critic
// deleted the single line that remembers what was last published — restoring
// the entire re-render storm this file claims to guard — and all of them
// stayed green, because the decision lived in a closure inside a `useEffect`
// that nothing could call. The decision now lives in `createBoardTaskMirror`
// (components/office/officePolling.ts) and the tests below RUN it. That exact
// mutation now fails at "publishes nothing at all when nothing changed".

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createBoardTaskMirror, boardTasksChanged, BOARD_TASK_MIRROR_TICK_MS,
} from '@/components/office/officePolling'

const src = readFileSync(join(__dirname, '..', 'hooks', 'useAgentStatus.ts'), 'utf-8')

/** The "Board task polling" effect body, isolated so an unrelated change
 *  elsewhere in the file cannot mask a regression here. */
function boardTaskEffect(): string {
  const start = src.indexOf('// ── Board task polling ──')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('// ── Supabase agent_runs polling ──', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

/** A mirror plus a log of everything it actually handed to React. */
function spyMirror() {
  const published: Array<Record<string, string>> = []
  const mirror = createBoardTaskMirror(v => { published.push(v) })
  return { mirror, published }
}

describe('the mirror publishes on a real change — and only then', () => {
  it('publishes the first time it sees anything, including an empty board', () => {
    // "Nothing in progress" is a real answer and has to reach the sidebar
    // once, or an office that just emptied keeps showing the old desks.
    const { mirror, published } = spyMirror()
    expect(mirror.sync({})).toBe(true)
    expect(published).toEqual([{}])
  })

  it('publishes nothing at all when nothing changed', () => {
    // THIS is the critic's surviving mutation, now caught. Deleting the
    // "remember what we published" line inside createBoardTaskMirror makes
    // every one of these ticks publish, which is the 5s re-render storm.
    const { mirror, published } = spyMirror()
    mirror.sync({ builder: 'TOD-9 ship the thing' })
    for (let tick = 0; tick < 12; tick++) {
      expect(mirror.sync({ builder: 'TOD-9 ship the thing' })).toBe(false)
    }
    expect(published).toHaveLength(1)
  })

  it('publishes when a title changes under the same assignee', () => {
    const { mirror, published } = spyMirror()
    mirror.sync({ builder: 'first task' })
    expect(mirror.sync({ builder: 'second task' })).toBe(true)
    expect(published).toEqual([{ builder: 'first task' }, { builder: 'second task' }])
  })

  it('publishes when two agents SWAP tasks — same size, same keys, different values', () => {
    // A length-only compare would miss this entirely and freeze the sidebar
    // on a reassignment, which is exactly the moment an operator is looking.
    const { mirror, published } = spyMirror()
    mirror.sync({ builder: 'A', tester: 'B' })
    expect(mirror.sync({ builder: 'B', tester: 'A' })).toBe(true)
    expect(published).toHaveLength(2)
  })

  it('publishes when an agent finishes and drops off the board', () => {
    const { mirror, published } = spyMirror()
    mirror.sync({ builder: 'A', tester: 'B' })
    expect(mirror.sync({ builder: 'A' })).toBe(true)
    expect(published[1]).toEqual({ builder: 'A' })
  })

  it('publishes a COPY, so a later mutation of the ref cannot edit what React rendered', () => {
    // boardTasksRef.current is reassigned/mutated by OfficeCanvas. Handing the
    // live object to React state would let a later write edit the value React
    // has already rendered — a UI that changed with no re-render behind it.
    const { mirror, published } = spyMirror()
    const live: Record<string, string> = { builder: 'original' }
    mirror.sync(live)
    live.builder = 'mutated afterwards'
    live.tester = 'appeared afterwards'
    expect(published[0]).toEqual({ builder: 'original' })
  })

  it('remembers what it published, so the next tick can be compared against it', () => {
    const { mirror } = spyMirror()
    expect(mirror.lastPublished()).toBeNull()
    mirror.sync({ builder: 'A' })
    expect(mirror.lastPublished()).toEqual({ builder: 'A' })
  })

  it('an idle office settles to ZERO publishes after the first — the §4 claim, executed', () => {
    // The doc claims "a steady office now settles to zero renders from this
    // effect". This is that sentence as an assertion rather than a promise:
    // one minute of 5s ticks over unchanged data.
    const { mirror, published } = spyMirror()
    const steady = { builder: 'TOD-9', tester: 'TOD-10' }
    const ticksPerMinute = 60_000 / BOARD_TASK_MIRROR_TICK_MS
    for (let i = 0; i < ticksPerMinute; i++) mirror.sync({ ...steady })
    expect(ticksPerMinute).toBe(12)
    expect(published).toHaveLength(1)
  })
})

describe('boardTasksChanged — the comparison itself', () => {
  it('treats "never published" as changed', () => {
    expect(boardTasksChanged(null, {})).toBe(true)
  })
  it('is false only for a key-for-key, value-for-value match', () => {
    expect(boardTasksChanged({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(false)
    expect(boardTasksChanged({ a: '1' }, { a: '2' })).toBe(true)
    expect(boardTasksChanged({ a: '1' }, { a: '1', b: '2' })).toBe(true)
    expect(boardTasksChanged({ a: '1', b: '2' }, { a: '1' })).toBe(true)
  })
  it('does not mistake a same-size map with different KEYS for unchanged', () => {
    expect(boardTasksChanged({ a: '1' }, { b: '1' })).toBe(true)
  })
})

describe('the mirror is wired into the hook, and still does not fetch', () => {
  it('makes no network call of its own', () => {
    // Pointing this second poller at /api/issues as well would have turned one
    // dead request into two live, identical ones — doubling egress for no new
    // data, the very cost OfficeCanvas's own poll raised its interval to avoid.
    const live = boardTaskEffect().split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l))
    expect(live.some(l => /fetch\s*\(/.test(l))).toBe(false)
  })

  it('drives the tested mirror rather than an inline copy of the rule', () => {
    // A grep, deliberately, and the ONLY thing left grepped here: it is the
    // one seam a unit test cannot reach without mounting the hook, and this
    // repo has no jsdom. It asserts the hook delegates — which is what makes
    // every executed test above true of the shipped screen.
    const body = boardTaskEffect()
    expect(body).toContain('createBoardTaskMirror(setBoardTasks)')
    expect(body).toContain('mirror.sync(boardTasksRef.current)')
    expect(body).toContain('setInterval(sync, BOARD_TASK_MIRROR_TICK_MS)')
  })
})

describe('the comment records the route history correctly', () => {
  it('says the route was RENAMED, not that it never existed', () => {
    // An earlier revision asserted "/api/tasks … never existed". It did exist;
    // fd7e5b5 moved it. That distinction is what makes "do not rebuild it" the
    // right call, so the file must not drift back to the wrong story.
    expect(src).toContain('fd7e5b5')
    expect(src).not.toContain('never existed')
  })
})
