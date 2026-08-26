// lib/__tests__/issue-verbs.test.ts — issue-permalink piece.
//
// jest.config.js runs these under `testEnvironment: "node"` (no `document`),
// so `sessionOperator()` always resolves `undefined` here — exactly the
// "viewer, or signed out" case `lib/issue-moves.ts`'s own docs describe.
// Every case below is chosen to be TRUE regardless of actor, the same way
// `defined`'s zero-field requirement is (see lib/issue-moves.ts: no branch
// keys on `defined`, so `requiredFieldsForMove` returns `[]` for it
// unconditionally) — this file is not asserting the actor-gated `backlog`
// path, which lib/__tests__/issue-moves.test.ts already owns.

import { readyIssueVerbs, runIssueVerb, withheldIssueVerbs } from '../issue-verbs'
import type { MoveIssue } from '../issue-moves'

describe('readyIssueVerbs', () => {
  // Measured 2026-08-26 against the running server: PATCH {id,
  // status:'defined'} on a fresh backlog `ops` row (owner already set by
  // POST, as it always is) was 200. That is exactly the row shape here.
  it('offers "Move to Defined" for a fresh backlog row with an owner', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const verbs = readyIssueVerbs(issue)
    expect(verbs.some(v => v.toStatus === 'defined' && v.label === 'Move to Defined')).toBe(true)
  })

  it('never offers the row\'s own current status', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const verbs = readyIssueVerbs(issue)
    expect(verbs.some(v => v.toStatus === 'backlog')).toBe(false)
  })

  // requiredFieldsForMove requires `test_tier` for a gated type moving to
  // `refined` — this row supplies none, so `refined` must NOT appear ready.
  it('does not offer a move that needs a field this row lacks', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const verbs = readyIssueVerbs(issue)
    expect(verbs.some(v => v.toStatus === 'refined')).toBe(false)
  })

  it('offers nothing for an issue with no owner (defined would be blocked, not ready)', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops' }
    const verbs = readyIssueVerbs(issue)
    expect(verbs.some(v => v.toStatus === 'defined')).toBe(false)
  })

  it('offers nothing for a closed (read-only) issue', () => {
    const issue: MoveIssue = { id: 'x', status: 'closed', type: 'ops', owner: 'ops' }
    expect(readyIssueVerbs(issue)).toEqual([])
  })
})

// Regression 2026-08-26: a critic found the overlay showing ZERO verbs and
// ZERO explanation on a closed issue, even though `moveVerdict` had "This
// issue is closed and read-only" in hand the whole time. `readyIssueVerbs`
// staying empty here is correct (closed is genuinely read-only) — the bug
// was that nothing surfaced WHY. `withheldIssueVerbs` is that "why".
describe('withheldIssueVerbs', () => {
  it('names the real reason a closed issue offers nothing, verbatim from moveVerdict', () => {
    const issue: MoveIssue = { id: 'x', status: 'closed', type: 'ops', owner: 'ops' }
    const withheld = withheldIssueVerbs(issue)
    expect(withheld.length).toBeGreaterThan(0)
    expect(withheld.every(w => /closed and read-only/.test(w.reason))).toBe(true)
  })

  it('never withholds the row\'s own current status', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    expect(withheldIssueVerbs(issue).some(w => w.toStatus === 'backlog')).toBe(false)
  })

  it('is disjoint from readyIssueVerbs — a status is never both offered and withheld', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const ready = new Set(readyIssueVerbs(issue).map(v => v.toStatus))
    const withheld = new Set(withheldIssueVerbs(issue).map(v => v.toStatus))
    for (const s of withheld) expect(ready.has(s)).toBe(false)
  })

  it('names the missing fields for a "needs" verdict — refined needs a description', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const withheld = withheldIssueVerbs(issue)
    const refined = withheld.find(w => w.toStatus === 'refined')
    expect(refined).toBeDefined()
    expect(refined?.reason).toMatch(/Needs/)
    expect(refined?.reason).toMatch(/Test tier/)
  })

  it('gives the no-owner block a real sentence for "defined", not a bare refusal', () => {
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops' }
    const defined = withheldIssueVerbs(issue).find(w => w.toStatus === 'defined')
    expect(defined?.reason).toMatch(/has no owner/)
  })
})

describe('runIssueVerb', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('PATCHes /api/issues with the move body and reports ok on 200', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return { ok: true, status: 200, json: async () => ({ id: 'x', status: 'defined' }) } as Response
    }) as typeof fetch

    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const result = await runIssueVerb(issue, 'defined')

    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/issues')
    expect(calls[0].init.method).toBe('PATCH')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toMatchObject({ id: 'x', status: 'defined' })
  })

  it('humanises a raw database refusal rather than passing it through', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'CHECK constraint failed: (status NOT IN (\'open\'' }),
    })) as unknown as typeof fetch

    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const result = await runIssueVerb(issue, 'defined')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).not.toMatch(/CHECK constraint/)
      expect(result.message).toMatch(/belong to a sprint/)
    }
  })

  it('reports a network failure instead of throwing', async () => {
    globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const issue: MoveIssue = { id: 'x', status: 'backlog', type: 'ops', owner: 'ops' }
    const result = await runIssueVerb(issue, 'defined')
    expect(result).toEqual({ ok: false, message: 'offline' })
  })
})
