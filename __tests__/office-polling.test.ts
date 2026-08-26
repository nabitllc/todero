// agent-visualization-fidelity: what the Office's two polls DO with an answer.
//
// These decisions used to live inside `useEffect` bodies in OfficeCanvas.tsx,
// where nothing could execute them, so they were "pinned" by grepping the
// component's source for the lines. A critic deleted `waitingRef.current={}`
// from the failure branch — the line that stops a dead poll from rendering a
// confident "nobody is waiting" — and only a grep noticed. Greps do not
// notice a refactor that keeps the characters and moves the meaning.
//
// Everything below is run.

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BOARD_TASKS_QUERY, WAITING_QUERY, BOARD_TASK_POLL_MS, WAITING_POLL_MS,
  boardTasksFromIssues, boardTaskPollOutcome, waitingPollOutcome,
  partitionWaiting, unroutedWaitingMessage,
} from '@/components/office/officePolling'

const canvasSrc = readFileSync(
  join(__dirname, '..', 'components', 'office', 'OfficeCanvas.tsx'), 'utf-8')

const FAILED = { ok: false as const, error: { status: 503, endpoint: '/api/inbox', message: 'upstream is down' } }

describe('BOARD_TASKS_QUERY — the Office asks for cross-project scope DELIBERATELY', () => {
  it('names the unbounded sentinel and the in_progress filter', () => {
    expect(BOARD_TASKS_QUERY).toContain('status=in_progress')
    expect(BOARD_TASKS_QUERY).toContain('limit=0')
  })

  it('carries all_projects=1', () => {
    // NOT decoration. The Office renders at BOTH `/p/<slug>/fleet/office` and
    // the bare `/fleet/office`. middleware.ts's projectFromPathname returns
    // null unless the path contains `/p/<slug>` (middleware.ts:66-73), so from
    // the bare URL there is no resolved scope AND no `x-mc-all-projects`
    // stamp, and app/api/issues/route.ts refuses with 400
    // `unscoped_issues_read`. Measured against the running dev server on
    // 2026-08-26, each with a fresh query string so the route's 30s cache
    // could not answer for a different scope:
    //   Referer /p/limiglow/fleet/office -> 200
    //   Referer /fleet/office            -> 400 unscoped_issues_read
    //   no Referer                       -> 400 unscoped_issues_read
    //   + all_projects=1, any Referer    -> 200
    // Without this token the Office's very first board-task poll 400s on a
    // fresh load and the operator sees a red banner and zero desks.
    expect(BOARD_TASKS_QUERY).toContain('all_projects=1')
  })

  it('is the string OfficeCanvas actually passes to fetchJson', () => {
    expect(canvasSrc).toContain('fetchJson<{ data: any[] }>(BOARD_TASKS_QUERY)')
    expect(canvasSrc).toContain('fetchJson<any>(WAITING_QUERY)')
  })

  it('the canvas builds its draw options from named refs, not from literals', () => {
    // WHAT THIS REPLACED, and why the replacement is not another grep.
    //
    // This slot used to hold an assertion labelled "THE ONE REMAINING GREP",
    // pinning `waiting:waitingRef.current,` as source text. A fresh-context
    // critic then walked around it: it left that string alone and passed `[]`
    // as the ROSTER argument two lines earlier, which classifies every waiting
    // agent as off-roster, empties `waitingRef.current` and makes a bubble
    // impossible — with all 77 lane tests green. Four more of its survivors
    // were sibling properties of the same object literal (`boardTasks:{}`,
    // `runs:{}`, `subagentCount:99`, `selectedId:null`), none of which any
    // grep enumerated.
    //
    // A whitelist of hand-picked source strings cannot be the guard for a
    // wiring layer, because it only ever guards the strings someone thought to
    // list. So the object literal is gone: OfficeCanvas now calls
    // `drawOptionsFromRefs(drawRefs, …)`, and every property of the result is
    // asserted by a test that RUNS it in __tests__/office-wiring.test.ts.
    //
    // What remains here is narrow and honest: that the component calls the
    // extracted builder at all, rather than reconstructing a literal beside it.
    expect(canvasSrc).toContain('drawOptionsFromRefs(drawRefs,')
    expect(canvasSrc).not.toContain('waiting:waitingRef.current,')
  })
})

describe('WAITING_QUERY and the poll cadences', () => {
  it('asks /api/inbox for PENDING rows specifically', () => {
    expect(WAITING_QUERY).toBe('/api/inbox?status=pending')
  })

  it('re-reads at most once a minute, and at least once a minute', () => {
    // A mutant that stretches this to a day leaves the bubble looking live
    // while being up to 24h stale. Both bounds are stated so neither drift
    // (a hammering 1s poll, or a frozen one) passes silently.
    for (const ms of [WAITING_POLL_MS, BOARD_TASK_POLL_MS]) {
      expect(ms).toBeGreaterThanOrEqual(10_000)
      expect(ms).toBeLessThanOrEqual(60_000)
    }
  })

  it('the intervals the component arms are these constants, not literals', () => {
    expect(canvasSrc).toContain('setInterval(fetchWaiting,WAITING_POLL_MS)')
    expect(canvasSrc).toContain('setInterval(fetchTasks,BOARD_TASK_POLL_MS)')
  })
})

describe('waitingPollOutcome — a failed poll drops every bubble AND says so', () => {
  it('returns NO bubbles and a non-null error together, from one call', () => {
    // Both halves in one return value, so no refactor can keep one and lose
    // the other. "No bubble" must never be able to mean "we could not ask".
    const out = waitingPollOutcome(FAILED)
    expect(out.waiting).toEqual({})
    expect(out.error).toBe(FAILED.error)
  })

  it('clears bubbles that a PREVIOUS successful poll had produced', () => {
    // The realistic sequence: builder was blocked, then the inbox went down.
    const good = waitingPollOutcome({ ok: true, data: [{ agent: 'builder' }, { agent: 'builder' }] })
    expect(good.waiting).toEqual({ builder: 2 })
    expect(waitingPollOutcome(FAILED).waiting).toEqual({})
  })

  it('counts a successful poll and raises no banner', () => {
    const out = waitingPollOutcome({ ok: true, data: [{ agent: 'builder' }, { context: { agent_id: 'scout' } }] })
    expect(out.waiting).toEqual({ builder: 1, scout: 1 })
    expect(out.error).toBeNull()
  })

  it('an empty inbox is zero bubbles and NO banner — a real answer, not a failure', () => {
    const out = waitingPollOutcome({ ok: true, data: [] })
    expect(out.waiting).toEqual({})
    expect(out.error).toBeNull()
  })

  it('a shape it cannot read degrades to no bubbles, never to a crash', () => {
    // /api/inbox answers a bare array unscoped and {data,…} when project= is
    // given. The Office asks unscoped; a shape change must not take the render
    // loop down with it.
    for (const body of [null, {}, { data: [{ agent: 'builder' }] }, 'nope', 0]) {
      expect(waitingPollOutcome({ ok: true, data: body }).waiting).toEqual({})
    }
  })
})

describe('boardTasksFromIssues / boardTaskPollOutcome', () => {
  it('maps assignee -> title for in_progress rows only', () => {
    expect(boardTasksFromIssues({
      data: [
        { status: 'in_progress', assignee: 'builder', title: 'ship it' },
        { status: 'backlog', assignee: 'tester', title: 'not started' },
      ],
    })).toEqual({ builder: 'ship it' })
  })

  it('skips a row with no assignee or no title rather than inventing one', () => {
    expect(boardTasksFromIssues({
      data: [
        { status: 'in_progress', title: 'unassigned' },
        { status: 'in_progress', assignee: 'scout' },
        { status: 'in_progress', assignee: '', title: 'blank' },
      ],
    })).toEqual({})
  })

  it('returns null — "do not touch the board" — for an unreadable body', () => {
    // Distinct from `{}`, which means "measured: nobody is working on
    // anything". An unparseable answer is not evidence of an empty office.
    for (const body of [null, undefined, {}, { data: 'nope' }, []]) {
      expect(boardTasksFromIssues(body)).toBeNull()
    }
  })

  it('a failed request keeps the last known board AND raises the banner', () => {
    const out = boardTaskPollOutcome({ ok: false, error: FAILED.error })
    expect(out.tasks).toBeNull()
    expect(out.error).toBe(FAILED.error)
  })

  it('OfficeCanvas applies the outcome through the executed helper', () => {
    // The rule itself — banner raised, map left alone on an unreadable answer
    // — is asserted by running `applyBoardTaskOutcome` in
    // __tests__/office-wiring.test.ts. This line only checks the component did
    // not quietly re-inline it, which is all a grep is good for.
    expect(canvasSrc).toContain('applyBoardTaskOutcome(boardTaskPollOutcome(r), boardTasksRef, setPollError)')
  })
})

describe('partitionWaiting — a pending row with nowhere to draw it is not swallowed', () => {
  const roster = ['builder', 'tester', 'scout']

  it('keeps the counts the canvas can draw', () => {
    const s = partitionWaiting({ builder: 2, tester: 1 }, roster)
    expect(s.drawable).toEqual({ builder: 2, tester: 1 })
    expect(s.unroutedIds).toEqual([])
    expect(s.unroutedRows).toBe(0)
  })

  it('separates out an id that is not on this floor, with its row count intact', () => {
    // Reported live by a reviewing critic on 2026-08-26: /api/inbox named
    // `lane7-critic-agent`, which is not one of the ids /api/agents returns,
    // and the canvas's `waiting[ag.id]||0` lookup discarded it with no bubble
    // and no notice anywhere on the screen.
    const s = partitionWaiting({ builder: 1, 'lane7-critic-agent': 3 }, roster)
    expect(s.drawable).toEqual({ builder: 1 })
    expect(s.unroutedIds).toEqual(['lane7-critic-agent'])
    expect(s.unroutedRows).toBe(3)
  })

  it('sums rows across several off-roster agents', () => {
    const s = partitionWaiting({ zeta: 2, alpha: 1 }, roster)
    expect(s.unroutedIds).toEqual(['alpha', 'zeta'])
    expect(s.unroutedRows).toBe(3)
  })

  it('an empty roster makes everything unroutable — it does not fabricate a floor', () => {
    const s = partitionWaiting({ builder: 1 }, [])
    expect(s.drawable).toEqual({})
    expect(s.unroutedRows).toBe(1)
  })
})

describe('unroutedWaitingMessage — the sentence the Office says out loud', () => {
  it('says nothing when there is nothing to say', () => {
    expect(unroutedWaitingMessage([], 0)).toBeNull()
    expect(unroutedWaitingMessage(['a'], 0)).toBeNull()
  })

  it('names the single agent and the exact number of requests', () => {
    const m = unroutedWaitingMessage(['lane7-critic-agent'], 1)!
    expect(m).toContain('lane7-critic-agent')
    expect(m).toContain('1 request is')
    expect(m).toContain('inbox')
  })

  it('counts agents rather than listing them once there are several', () => {
    const m = unroutedWaitingMessage(['a', 'b'], 5)!
    expect(m).toContain('2 agents')
    expect(m).toContain('5 requests are')
  })

  it('OfficeCanvas pushes it to the feed through the executed helper', () => {
    // The de-duplication that stops a 60s poll repeating one sentence a minute
    // moved INTO `applyWaitingOutcome`, where office-wiring.test.ts calls it
    // twice and asserts the second call added nothing to the feed. This is
    // only the "did not re-inline it" check.
    expect(canvasSrc).toContain('applyWaitingOutcome(')
  })
})
