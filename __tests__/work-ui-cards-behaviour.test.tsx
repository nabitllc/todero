// __tests__/work-ui-cards-behaviour.test.tsx — Work Management UI, cards lane,
// ROUND 2.
//
// WHY THIS FILE EXISTS
// --------------------
// A fresh-context critic mutation-tested this lane and found that four of nine
// planted mutants SURVIVED — including the whole of "rejected writes are now
// visible" and the whole of "a count may never blank a body", the piece's two
// headline claims. Its diagnosis was exact: round 1's tests exercised only the
// pure helpers, never the components that consume them, so the behaviour could
// be reverted with `tsc`, `npm test`, `no-silent-empty` and the smoke test all
// green.
//
// WHAT THIS FILE CAN AND CANNOT PROVE
// -----------------------------------
// This repo's jest is `testEnvironment: "node"`. There is no jsdom and no
// @testing-library, and neither is in devDependencies — adding them means
// editing package.json and jest.config.js, which are not this lane's files
// while nine other lanes are running. The exact diff to add them is written up
// as a requested seam in docs/rebuild/pieces/pieces8/work-ui-cards.md §11.
//
// CORRECTION, ROUND 3 (2026-08-26). The paragraph that stood here said "the
// components were restructured instead, so that the branches the critic deleted
// became reachable without a DOM." That was true of `WorkViewCardView` and
// FALSE of the component `app/page.tsx` actually mounts. A second critic
// mutation-tested the DEFAULT exports and 12 of 32 mutations survived this file
// at 51/51 green — including verbatim TOD-2444 (`children={undefined}` after
// the `{...props}` spread) and `setLoaded(true) -> setLoaded(false)`. The
// restructuring moved the untested layer; it did not remove it.
//
// It is removed now, and NOT by restructuring: `__tests__/work-ui-wiring.test.tsx`
// mounts the default exports for real and presses their buttons, using a
// ~180-line dispatcher-driven micro-renderer instead of a new dependency. All
// 12 of those mutants now fail, plus 8 more. This file keeps what it is good
// at — the pure view in states a mount cannot easily force, and the request
// functions in isolation.
//
// The paragraph as originally written:
//
// So the components were restructured instead, so that the branches the critic
// deleted became reachable without a DOM:
//
//   • RENDERING is a pure, prop-driven component (`WorkViewCardView`). Every
//     branch that previously needed a resolved fetch inside useEffect is now
//     one `renderToStaticMarkup` call. Assertions here are against the real
//     emitted markup string.
//   • REQUESTS are exported async functions (`fetchCountTotal`,
//     `saveIssueFields`, `bulkMoveStatus`) driven by a mocked `global.fetch`.
//     These are real calls with real awaits; the request bodies and the counts
//     of requests are asserted.
//
// NOT proven here, stated plainly rather than implied:
//   • No click, keypress, drag or focus is exercised IN THIS FILE. Round 2 put
//     five `expect(src).toContain(...)` "source guards" at the bottom of this
//     file to stand in for that. The same critic defeated all five with
//     one-token edits that leave the guarded string intact —
//     `{false && writeError && (`, `if (false && error) {`,
//     `const retryFailedWrite = () => { return`. A string grep is not a test
//     of behaviour, and a grep that a mutation walks straight past is worse
//     than no test because it reads as coverage. All five are DELETED in round
//     3 and replaced by real mounted-and-clicked tests in
//     `__tests__/work-ui-wiring.test.tsx`.
//   • Round 2's doc said this block held six guards. It held five.
//   • No browser. Nothing here is DOM-level or visual evidence.

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WorkViewCardView,
  fetchCountTotal,
  countQueryFor,
  countVerbFor,
  emptyNoteAboveBody,
} from '@/components/tabs/WorkViewCard'
import { saveIssueFields, bulkMoveStatus } from '@/components/tabs/IssuesTab'
import { KanbanCard, timeSignalFor } from '@/components/KanbanCard'
import type { Task } from '@/lib/issues'
import type { ApiError } from '@/hooks/useApiData'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── a Response stand-in with only what the code under test reads ────────────
function res(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 400 ? 'Bad Request' : '',
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response
}

const BODY = '<p data-testid="the-body">the child surface</p>'
const body = <p data-testid="the-body">the child surface</p>

const viewProps = {
  id: 'work-backlog',
  title: 'What is in the backlog?',
  projectFilter: 'Limiglow',
  countLabel: 'in backlog',
  emptyMessage: (p: string) => `${p} has no issues yet — that is correct, not broken.`,
  source: '/api/issues?project=Limiglow&limit=1&status=backlog',
  total: null as number | null,
  error: null as ApiError | null,
  loaded: false,
  onRetry: () => {},
}

const refused: ApiError = {
  status: 500,
  endpoint: '/api/issues',
  message: 'database is not reachable',
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. A fact about THE COUNT may never delete a surface that is not the count.
//
// This is TOD-2444, and the critic's two surviving WorkViewCard mutants both
// live in this block: "drop {children} from the error branch" and "ignore
// emptyStatePlacement and blank the body again". Each assertion below fails if
// its mutant is applied.
// ═════════════════════════════════════════════════════════════════════════════
describe('WorkViewCardView — the body survives every state of the count', () => {
  it('keeps the children when the COUNT query is refused (verbatim TOD-2444)', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} error={refused} loaded>{body}</WorkViewCardView>
    )
    // The error is loud...
    expect(html).toContain('data-testid="api-error-banner"')
    expect(html).toContain('database is not reachable')
    // ...and the child surface, which owns a DIFFERENT query and its own error
    // banner, is still on screen. On work/list this is the entire issues table,
    // whose own request had not even been made when the count failed.
    expect(html).toContain(BODY)
  })

  it('keeps the children at a count of zero, as a note and not a replacement', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} total={0} loaded>{body}</WorkViewCardView>
    )
    expect(html).toContain(BODY)
  })

  it('keeps the children when no project has resolved yet', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} projectFilter={null}>{body}</WorkViewCardView>
    )
    expect(html).toContain(BODY)
    expect(html).toContain('No project selected yet')
  })

  it('lets the empty sentence take the body ONLY when there is no body', () => {
    const headerOnly = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} total={0} loaded />
    )
    // Header-only card (work/epics, work/bolt): the sentence IS the card, and
    // it is the caller's, naming the project.
    expect(headerOnly).toContain('Limiglow has no issues yet')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. The note above a body may not repeat a sentence that is now false.
//
// Round 2 defect, the critic's: round 1 stopped the count deleting the table
// and then printed "Limiglow has no issues yet" directly above a table of
// Limiglow's issues, because work/list counts &status=backlog while the table
// lists everything. Round 1 flagged it and shipped it.
// ═════════════════════════════════════════════════════════════════════════════
describe('WorkViewCardView — the zero-count note does not contradict the body', () => {
  it('does NOT relay the caller’s project-level sentence above a populated body', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} total={0} loaded>{body}</WorkViewCardView>
    )
    expect(html).not.toContain('has no issues yet')
  })

  it('says only what the card can prove: its own count, and that the body is a different query', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} total={0} loaded>{body}</WorkViewCardView>
    )
    expect(html).toContain('No rows in Limiglow match this card')
    expect(html).toContain('in backlog')
    expect(html).toContain('runs its own query')
  })

  it('names the project and the count label in the note', () => {
    expect(emptyNoteAboveBody('Limiglow', 'in backlog')).toContain('Limiglow')
    expect(emptyNoteAboveBody('Limiglow', 'in backlog')).toContain('in backlog')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. The metric: a real number with an agreeing noun, or no metric at all.
// ═════════════════════════════════════════════════════════════════════════════
describe('WorkViewCardView — the metric', () => {
  it('renders no number at all while the count is in flight', () => {
    const html = renderToStaticMarkup(<WorkViewCardView {...viewProps} loaded={false} />)
    // A fabricated 0 beside a real label is the failure mode. Neither the digit
    // nor the label may appear in the header before a real total arrives.
    expect(html).not.toContain('in backlog')
  })

  it('agrees with its number at exactly one — the live "1 epics" defect', () => {
    // MEASURED read-only against db.sqlite on 2026-08-26, at the start of
    // that session: Limiglow held 1 issue and it was an epic, so the Epics
    // card's real count was 1. (It was 0 again by the end of the session —
    // another lane's fixture. A count of 1 is what this pins, not that count.)
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} countLabel="epics" total={1} loaded />
    )
    expect(html).toContain('epic<')
    expect(html).not.toContain('epics<')
  })

  it('leaves a plural alone away from one', () => {
    const html = renderToStaticMarkup(
      <WorkViewCardView {...viewProps} countLabel="epics" total={4} loaded />
    )
    expect(html).toContain('epics<')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. The count request itself.
// ═════════════════════════════════════════════════════════════════════════════
describe('fetchCountTotal', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })

  it('scopes the query to the project and asks for the exact total, not a page', () => {
    const q = countQueryFor('Limiglow', '&type=epic')
    expect(q).toBe('/api/issues?project=Limiglow&limit=1&type=epic')
    // limit=0 on this route means EVERY matching row, which would fetch
    // thousands to render one number.
    expect(q).not.toContain('limit=0')
    expect(countQueryFor(null)).toBeNull()
  })

  it('reads the total off a 200', async () => {
    global.fetch = jest.fn(async () => res(200, { data: [], total: 7 })) as unknown as typeof fetch
    await expect(fetchCountTotal('/api/issues?project=Limiglow&limit=1'))
      .resolves.toEqual({ total: 7, error: null })
  })

  it('turns a refusal into an error and NEVER into a total', async () => {
    global.fetch = jest.fn(async () => res(500, { error: 'database is not reachable' })) as unknown as typeof fetch
    const out = await fetchCountTotal('/api/issues?project=Limiglow&limit=1')
    expect(out.total).toBeNull()
    expect(out.error).not.toBeNull()
    expect(out.error!.status).toBe(500)
    expect(out.error!.message).toBe('database is not reachable')
  })

  it('reports an unreachable server as status 0 rather than swallowing it', async () => {
    global.fetch = jest.fn(async () => { throw new Error('fetch failed') }) as unknown as typeof fetch
    const out = await fetchCountTotal('/api/issues?project=Limiglow&limit=1')
    expect(out.total).toBeNull()
    expect(out.error).toEqual({
      status: 0,
      endpoint: '/api/issues',
      message: 'fetch failed',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. The write path — the piece's biggest claim, and the critic's mutant M8.
//
// Deleting the non-ok branch used to leave 15/15 green. It now fails here.
// ═════════════════════════════════════════════════════════════════════════════
describe('saveIssueFields — a rejected write is a returned error, never silence', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })

  it('sends the edited fields with the id, as a PATCH', async () => {
    const spy = jest.fn(async () => res(200, { id: 'i1', status: 'code_review' }))
    global.fetch = spy as unknown as typeof fetch
    const out = await saveIssueFields('i1', { status: 'code_review', assignee: 'builder' })
    expect(out.error).toBeNull()
    expect(out.row).toEqual({ id: 'i1', status: 'code_review' })
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/issues')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      id: 'i1', status: 'code_review', assignee: 'builder',
    })
  })

  it('surfaces the server’s own reason for a 400 and returns no row', async () => {
    // The commonest real refusal on this route: moving to a review status
    // without regression_test, which /api/issues rejects by design.
    global.fetch = jest.fn(async () =>
      res(400, { error: 'regression_test is required to move to code_review', code: 'MISSING_FIELD' })
    ) as unknown as typeof fetch
    const out = await saveIssueFields('i1', { status: 'code_review' })
    expect(out.row).toBeNull()
    expect(out.error).not.toBeNull()
    expect(out.error!.status).toBe(400)
    expect(out.error!.message).toBe('regression_test is required to move to code_review')
    expect(out.error!.code).toBe('MISSING_FIELD')
    expect(out.error!.endpoint).toBe('PATCH /api/issues')
  })

  it('reports a network failure rather than resolving as if nothing happened', async () => {
    global.fetch = jest.fn(async () => { throw new Error('connection reset') }) as unknown as typeof fetch
    const out = await saveIssueFields('i1', { status: 'open' })
    expect(out.row).toBeNull()
    expect(out.error).toEqual({
      status: 0, endpoint: 'PATCH /api/issues', message: 'connection reset',
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. Partial bulk failure — the critic's mutant M9, and the retry-scope defect.
// ═════════════════════════════════════════════════════════════════════════════
describe('bulkMoveStatus — a partial failure is counted, named, and retryable', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })

  const KEYS: Record<string, string> = { a: 'TOD-101', b: 'TOD-102', c: 'TOD-103' }
  const keyOf = (id: string) => KEYS[id] ?? id

  /** Fails exactly the ids in `failing`; succeeds everything else. */
  function fetchFailing(failing: string[]) {
    return jest.fn(async (_url: string, init: RequestInit) => {
      const { id, status } = JSON.parse(String(init.body))
      return failing.includes(id)
        ? res(400, { error: 'regression_test is required to move to code_review' })
        : res(200, { id, status })
    })
  }

  it('applies the rows that moved and names the one that did not', async () => {
    const spy = fetchFailing(['b'])
    global.fetch = spy as unknown as typeof fetch

    const out = await bulkMoveStatus(['a', 'b', 'c'], 'code_review', keyOf)

    expect(spy).toHaveBeenCalledTimes(3)
    // The two that succeeded are still applied — a partial failure is not a
    // reason to discard real server state.
    expect(out.appliedRows.map(r => r.id)).toEqual(['a', 'c'])
    expect(out.failedIds).toEqual(['b'])
    expect(out.error).not.toBeNull()
    // Named by TASK KEY. An id alone is not something an operator can act on.
    expect(out.error!.message).toContain('TOD-102')
    expect(out.error!.message).toContain('1 of 3')
    expect(out.error!.message).toContain('code review')
    expect(out.error!.message).toContain('regression_test is required')
    // The keys that DID move must not be blamed.
    expect(out.error!.message).not.toContain('TOD-101')
    expect(out.error!.message).not.toContain('TOD-103')
  })

  it('leaves exactly the failed rows selected, with the target status still chosen', async () => {
    global.fetch = fetchFailing(['b']) as unknown as typeof fetch
    const out = await bulkMoveStatus(['a', 'b', 'c'], 'code_review', keyOf)
    expect(out.nextSelection).toEqual(['b'])
    expect(out.nextBulkStatus).toBe('code_review')
  })

  // THE defect the critic found in round 1's own retry story. The old code
  // stashed the handler in a ref from inside the handler, pinning that render's
  // closure, so the bar said "1 selected" while Retry re-PATCHed all three.
  // The outcome now carries the retry target as DATA, and this asserts what a
  // retry actually sends.
  it('a retry of the outcome re-sends ONLY the row that failed', async () => {
    global.fetch = fetchFailing(['b']) as unknown as typeof fetch
    const first = await bulkMoveStatus(['a', 'b', 'c'], 'code_review', keyOf)

    const retrySpy = fetchFailing([])
    global.fetch = retrySpy as unknown as typeof fetch
    const second = await bulkMoveStatus(first.nextSelection, first.nextBulkStatus, keyOf)

    expect(retrySpy).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(String((retrySpy.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(sent).toEqual({ id: 'b', status: 'code_review' })
    expect(second.error).toBeNull()
    expect(second.nextSelection).toEqual([])
  })

  it('clears the bar only when everything landed', async () => {
    global.fetch = fetchFailing([]) as unknown as typeof fetch
    const out = await bulkMoveStatus(['a', 'b'], 'open', keyOf)
    expect(out.error).toBeNull()
    expect(out.failedIds).toEqual([])
    expect(out.nextSelection).toEqual([])
    expect(out.nextBulkStatus).toBe('')
    expect(out.appliedRows).toHaveLength(2)
  })

  // ROUND 3. Round 2 asserted what a retry DOES and never read the sentence it
  // shows, so `only those ${countVerbFor(n, 'rows', 'row')}` shipped and read
  // "only those row" at n = 1: the noun was singularised and the demonstrative
  // in front of it was left plural. That is the same disagreement as
  // "1 issues" and "1 issue are loaded" — this file's own subject — written one
  // line below the helper that exists to prevent it. Found by mounting the
  // component and reading the banner; pinned at both ends here.
  it('says "only that row" at one refusal, not "only those row"', async () => {
    global.fetch = fetchFailing(['b']) as unknown as typeof fetch
    const out = await bulkMoveStatus(['a', 'b'], 'code_review', keyOf)
    expect(out.error!.message).toContain('Retry re-sends only that row.')
    expect(out.error!.message).not.toContain('those row')
  })

  it('states the count in the plural rather than making the operator re-read it', async () => {
    global.fetch = fetchFailing(['a', 'b']) as unknown as typeof fetch
    const out = await bulkMoveStatus(['a', 'b', 'c'], 'code_review', keyOf)
    expect(out.error!.message).toContain('Retry re-sends only those 2 rows.')
  })

  it('does not report success when EVERY row was refused', async () => {
    global.fetch = fetchFailing(['a', 'b']) as unknown as typeof fetch
    const out = await bulkMoveStatus(['a', 'b'], 'code_review', keyOf)
    expect(out.error).not.toBeNull()
    expect(out.error!.message).toContain('2 of 2')
    expect(out.appliedRows).toEqual([])
    expect(out.nextSelection).toEqual(['a', 'b'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. Subject-verb agreement — round 2's defect inside round 1's own fix.
// ═════════════════════════════════════════════════════════════════════════════
describe('countVerbFor — "1 issue are loaded" was the bug inside the fix', () => {
  it('agrees at one', () => {
    expect(countVerbFor(1, 'are', 'is')).toBe('is')
    expect(countVerbFor(1, 'them', 'it')).toBe('it')
  })
  it('stays plural away from one', () => {
    expect(countVerbFor(0, 'are', 'is')).toBe('are')
    expect(countVerbFor(2, 'are', 'is')).toBe('are')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. The benchmark sentence: "the board tells you where work is stuck without
//    you asking."
//
// Round 1 rendered no time signal at all on the card the default board uses.
// Linear's is true time-in-state; this app has no status_changed_at column and
// no status history table, so the card shows only what its two real columns
// support and LABELS which one — the wording is the contract under test here.
// ═════════════════════════════════════════════════════════════════════════════
describe('KanbanCard age signal', () => {
  const T0 = Date.parse('2026-08-26T12:00:00.000Z')
  const at = (msAgo: number) => new Date(T0 - msAgo).toISOString()
  const HOUR = 3600_000

  it('shows the age of the WORK for a row that is in progress', () => {
    const s = timeSignalFor(
      { id: 'x', title: 't', status: 'in_progress', started_at: at(4 * HOUR + 12 * 60_000) } as Task,
      T0,
    )
    expect(s!.label).toBe('started 4h 12m ago')
    expect(s!.accessibleLabel).toBe('work started 4h 12m ago')
  })

  it('flags in-progress work that has run past a day, and only there', () => {
    const old = timeSignalFor(
      { id: 'x', title: 't', status: 'in_progress', started_at: at(30 * HOUR) } as Task, T0,
    )
    expect(old!.needsAttention).toBe(true)

    const fresh = timeSignalFor(
      { id: 'x', title: 't', status: 'in_progress', started_at: at(3 * HOUR) } as Task, T0,
    )
    expect(fresh!.needsAttention).toBe(false)

    // A row sitting in code_review for a month is NOT flagged, because
    // updated_at cannot support the claim that it has been stuck there.
    const reviewing = timeSignalFor(
      { id: 'x', title: 't', status: 'code_review', updated_at: at(30 * 24 * HOUR) } as Task, T0,
    )
    expect(reviewing!.needsAttention).toBe(false)
  })

  it('calls updated_at "updated", never "waiting" or "in this column"', () => {
    const s = timeSignalFor(
      { id: 'x', title: 't', status: 'code_review', updated_at: at(6 * 24 * HOUR) } as Task, T0,
    )
    // updated_at moves on ANY edit. The stronger wording would be a fabrication.
    expect(s!.label).toBe('updated 6d ago')
    expect(s!.label).not.toContain('waiting')
    expect(s!.label).not.toContain('column')
    expect(s!.label).not.toContain('stuck')
  })

  it('renders no chip at all rather than a fabricated zero', () => {
    expect(timeSignalFor({ id: 'x', title: 't', status: 'open' } as Task, T0)).toBeNull()
    expect(timeSignalFor({ id: 'x', title: 't', status: 'open', updated_at: 'not a date' } as Task, T0)).toBeNull()
    // in_progress with no started_at falls back to updated_at, and to nothing
    // when that is absent too.
    expect(timeSignalFor({ id: 'x', title: 't', status: 'in_progress' } as Task, T0)).toBeNull()

    const html = renderToStaticMarkup(
      <KanbanCard task={{ id: 'x', title: 'no timestamps' } as Task} now={T0} />
    )
    expect(html).not.toContain('ago')
  })

  it('puts the fact on the card in both senses', () => {
    const html = renderToStaticMarkup(
      <KanbanCard
        task={{ id: 'x', title: 't', status: 'in_progress', started_at: at(30 * HOUR) } as Task}
        now={T0}
      />
    )
    expect(html).toContain('started 1d 6h ago')
    expect(html).toMatch(/<span class="sr-only">work started 1d 6h ago<\/span>/)
    // Past a day, the chip is not the same grey as everything else.
    expect(html).toContain('text-amber-400')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 9. THE SOURCE GUARDS THAT USED TO LIVE HERE ARE GONE.
//
// Five `expect(src).toContain('…')` assertions over IssuesTab's wiring stood
// here. A critic defeated every one of them with an edit that left the guarded
// string byte-identical, so they certified nothing while reading as coverage.
// The behaviours they claimed to pin — the banner rendering, Retry re-sending
// the right request with the current edits, the editor staying open on a
// rejection, the bulk outcome feeding back into the selection — are all
// asserted against a mounted component in
// `__tests__/work-ui-wiring.test.tsx`, where the button is genuinely pressed.
// ═════════════════════════════════════════════════════════════════════════════
