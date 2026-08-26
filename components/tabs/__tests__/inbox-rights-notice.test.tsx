/**
 * components/tabs/__tests__/inbox-rights-notice.test.tsx — the UI half of the
 * approval surface, which had NO test at all.
 *
 * THE MUTANT THIS EXISTS TO KILL. A fresh critic changed line 234 of
 * components/tabs/InboxTab.tsx from
 *
 *     if (!rights) return null
 *   to
 *     if (true) return null
 *
 * — deleting the entire `rightsNotice` warning, which is the whole UI half of
 * the piece's §9.5 claim ("the operator otherwise learns their session cannot
 * approve only by clicking and reading a 403"). Every approval suite stayed
 * green. I REPRODUCED THAT MYSELF before writing this file, on 2026-08-26,
 * with the same mutation applied to the shipped tree:
 *
 *     npx jest --no-cache InboxTab inbox approval approvals
 *     -> Test Suites: 6 passed, 6 total   Tests: 88 passed, 88 total
 *
 * The reason is that nothing RENDERED the component. `inbox-actor-attribution
 * .test.ts` is the only file that names InboxTab and it imports the pure
 * `splitActor()` export. The notice even carries
 * `data-testid="inbox-rights-notice"` whose only occurrence in the whole repo
 * was that JSX line — a test hook with no test.
 *
 * HOW THIS TESTS IT. `renderToStaticMarkup` in the node environment jest is
 * configured with. `useEffect` does not run under it, so `useApiData` is
 * mocked to return the payload the server would have delivered: this pins
 * what the operator SEES for a given server answer, which is exactly the
 * property the mutant broke and exactly what a pure-function test cannot see.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. This is server-side markup, not a
 * browser. It proves the element is emitted with the right words; it does not
 * prove the element is visible, contrasty, or above the fold. No browser tool
 * was available to this lane and no such claim is made anywhere in it.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

/** The `decide` block GET /api/inbox returns. */
interface Rights {
  role: string | null
  can_record: boolean
  can_approve: boolean
  ignored_role_claim: string | null
}

/** What the mocked `useApiData` should answer for the pending query. */
let pendingPayload: unknown = null
let decisionsPayload: unknown = null

jest.mock('@/hooks/useApiData', () => ({
  __esModule: true,
  useApiData: (endpoint: string | null) => ({
    data: endpoint === null
      ? null
      : endpoint.includes('/decisions')
        ? decisionsPayload
        : pendingPayload,
    error: null,
    loading: false,
    refetch: () => {},
  }),
  fetchJson: jest.fn(),
}))

jest.mock('@/components/nav/ProjectScope', () => ({
  __esModule: true,
  useProjectScope: () => ({ project: 'Limiglow', setProject: () => {} }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const InboxTab = require('../InboxTab').default as React.ComponentType

function render(rights: Rights | undefined, pending: unknown[] = []): string {
  pendingPayload = {
    data: pending,
    total: pending.length,
    has_more: false,
    scope: { project: 'Limiglow', matched: pending.length, other_project: 0, unresolvable: 0 },
    ...(rights ? { decide: rights } : {}),
  }
  decisionsPayload = { data: [], total: 0, has_more: false, scope: { project: 'Limiglow', inbox_id: null } }
  return renderToStaticMarkup(React.createElement(InboxTab))
}

const OWNER: Rights = { role: 'owner', can_record: true, can_approve: true, ignored_role_claim: null }
const VIEWER: Rights = { role: 'viewer', can_record: false, can_approve: false, ignored_role_claim: null }
const MEMBER: Rights = { role: 'member', can_record: true, can_approve: false, ignored_role_claim: null }
const NO_ROLE: Rights = { role: null, can_record: false, can_approve: false, ignored_role_claim: null }
const ESCALATING: Rights = { ...VIEWER, ignored_role_claim: 'owner' }

const NOTICE = 'data-testid="inbox-rights-notice"'
const CLAIM_NOTICE = 'data-testid="inbox-ignored-claim-notice"'

describe('the rights notice is actually rendered', () => {
  it('a viewer session is TOLD it cannot record anything, before it clicks', () => {
    const html = render(VIEWER)
    expect(html).toContain(NOTICE)
    expect(html).toContain('may not record any decision here')
    expect(html).toContain('403')
    // The role is named. "You cannot do this" without saying what you are is
    // an error message the operator cannot act on.
    expect(html).toContain('viewer')
  })

  it('a member session is told it may deny but not approve — the asymmetry, on screen', () => {
    const html = render(MEMBER)
    expect(html).toContain(NOTICE)
    expect(html).toContain('deny or acknowledge')
    expect(html).toContain('not approve')
    expect(html).toContain('member')
    // and NOT the stronger sentence meant for a session that may record nothing
    expect(html).not.toContain('may not record any decision here')
  })

  it('a session that proved no role gets the no-role wording, not an invented role name', () => {
    const html = render(NO_ROLE)
    expect(html).toContain(NOTICE)
    expect(html).toContain('a session that proved no role')
    expect(html).not.toContain('a "null" session')
  })

  // THE DISCRIMINATOR. Without this, "render the notice always" would pass
  // every case above — the mutant's mirror image.
  it('an owner session that CAN approve is shown no notice at all', () => {
    const html = render(OWNER)
    expect(html).not.toContain(NOTICE)
  })

  it('a server answer with no `decide` block claims nothing rather than guessing', () => {
    const html = render(undefined)
    expect(html).not.toContain(NOTICE)
    expect(html).not.toContain(CLAIM_NOTICE)
  })
})

describe('an ignored mc-role claim is surfaced, not swallowed', () => {
  it('names the role the cookie asked for and says it was ignored', () => {
    const html = render(ESCALATING)
    expect(html).toContain(CLAIM_NOTICE)
    expect(html).toContain('asks to act as &quot;owner&quot;')
    expect(html).toContain('narrow a role, never widen it')
  })

  it('is shown even to a session that CAN approve — something on this browser is lying', () => {
    const html = render({ ...OWNER, ignored_role_claim: 'god' })
    // No rights notice (this session can approve) but the claim notice stands.
    expect(html).not.toContain(NOTICE)
    expect(html).toContain(CLAIM_NOTICE)
    expect(html).toContain('god')
  })

  it('no claim, no notice', () => {
    expect(render(OWNER)).not.toContain(CLAIM_NOTICE)
    expect(render(VIEWER)).not.toContain(CLAIM_NOTICE)
  })
})

// ─── The defect this file found on its first run ────────────────────────────
//
// Every case above renders with an EMPTY pending list, and on 2026-08-26 all
// five notice assertions failed against the shipped tree — not because the
// notice was conditional on rights, but because both notices were CHILDREN of
// the "Waiting on you" card and components/nav/Card.tsx:134 is
//
//     {isEmpty ? <p className="…">{empty!.message}</p> : children}
//
// so an empty queue replaced them with the empty message. A viewer session
// with nothing pending — and a browser carrying an escalating `mc-role`
// cookie with nothing pending — were told nothing at all. That was invisible
// from reading InboxTab.tsx, because the suppression is in the other
// component; it took rendering. The notices are hoisted above the cards now.
//
// These two cases pin both halves so it cannot come back from either side.
describe('the notice does not depend on how many requests are pending', () => {
  const ENTRY = {
    id: 'ib-fixture-1',
    agent: 'lane5-fixture-agent',
    type: 'loop_breaker_pause',
    context: { agent_id: 'lane5-fixture-agent' },
    status: 'pending',
    created_at: new Date().toISOString(),
    expires_at: null,
    resolved_at: null,
    resolved_by: null,
    response_data: null,
    issue_id: null,
  }

  it('shown with an EMPTY queue (the regression: the card dropped its children)', () => {
    expect(render(VIEWER, [])).toContain(NOTICE)
    expect(render(ESCALATING, [])).toContain(CLAIM_NOTICE)
  })

  it('shown with a NON-empty queue as well', () => {
    expect(render(VIEWER, [ENTRY])).toContain(NOTICE)
    expect(render(ESCALATING, [ENTRY])).toContain(CLAIM_NOTICE)
  })
})

describe('the surface still renders its cards', () => {
  it('the empty state names the project rather than implying the fleet is quiet', () => {
    const html = render(OWNER)
    expect(html).toContain('Limiglow')
    // `source` is the contract from components/nav/Card.tsx: the query that
    // produced the number is printed next to it.
    expect(html).toContain('/api/inbox?status=pending&amp;project=Limiglow')
  })
})
