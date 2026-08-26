/**
 * components/tabs/__tests__/approval-card.test.ts — three-fabrications #3.
 *
 * THE FABRICATION. components/tabs/ApprovalCard.tsx claimed, in its own
 * header, "A label therefore cannot promise an effect the server would
 * refuse", citing the import-time check in app/api/inbox/route.ts. That check
 * compares two SETS OF TYPE KEYS; it cannot see the per-row preflight, and
 * `describeApproval()` never called `preflightDecision()`. Measured: of four
 * approval cards rendered live, two carried an Approve button the server
 * refuses with a 409 — NO_AGENT and TARGET_MISSING.
 *
 * THE DISCRIMINATOR. Every case below is decided by `approveGate()`, which
 * runs the SAME `preflightDecision()` the route runs. Against the old
 * behaviour — the button rendered whenever `describeApproval().approveLabel`
 * was non-null — the first three cases assert the opposite answer, and the
 * fourth pins the working case so the fix cannot be "disable everything".
 */

import { approveGate, type ApprovalLookup } from '../ApprovalCard'
import { preflightDecision, type ApprovalRow } from '@/lib/approvals'

/** No issue to look up: the honest tri-state, NOT 'unverified'. */
const NO_ISSUE: ApprovalLookup = { issueExists: null, issueRef: null }

function row(patch: Partial<ApprovalRow>): ApprovalRow {
  return {
    id: 'ib-1',
    agent: 'builder',
    type: 'loop_breaker_pause',
    context: { last_issue_id: 'issue-uuid-1' },
    status: 'pending',
    ...patch,
  }
}

/** The old rule: render the button whenever a label exists. */
function oldButtonRendered(r: ApprovalRow): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { describeApproval } = require('@/lib/approvals')
  return describeApproval(r).approveLabel !== null
}

describe('approveGate — the button cannot promise what the server refuses', () => {
  it('NO_AGENT: a request with no agent id gets a dead button and the server’s own sentence', () => {
    const r = row({ agent: null, context: {} })
    const gate = approveGate(r, NO_ISSUE)

    // The old rule rendered this button live. That is the measured defect.
    expect(oldButtonRendered(r)).toBe(true)

    expect(gate.enabled).toBe(false)
    expect(gate.block).toBe('NO_AGENT')
    // Verbatim, not paraphrased: the operator reads the same words the API
    // would have returned, so the surface and the server cannot drift.
    const server = preflightDecision({ row: r, decision: 'approved', lookup: NO_ISSUE })
    expect(server.ok).toBe(false)
    expect(gate.reason).toBe(server.ok ? null : server.reason)
  })

  it('TARGET_MISSING: a vanished issue gets a dead button and the server’s own sentence', () => {
    const r = row({})
    const lookup: ApprovalLookup = { issueExists: false, issueRef: 'issue-uuid-1' }
    const gate = approveGate(r, lookup)

    expect(oldButtonRendered(r)).toBe(true)

    expect(gate.enabled).toBe(false)
    expect(gate.block).toBe('TARGET_MISSING')
    expect(gate.reason).toContain('no longer exists')
    const server = preflightDecision({ row: r, decision: 'approved', lookup })
    expect(gate.reason).toBe(server.ok ? null : server.reason)
  })

  it('UNVERIFIED: an unanswered existence check is not a yes', () => {
    const gate = approveGate(row({}), 'unverified')
    expect(gate.enabled).toBe(false)
    expect(gate.block).toBe('UNVERIFIED')
    expect(gate.label).not.toBeNull()
    expect(gate.reason).toContain('has not been established yet')
  })

  it('a row with no issue to check is NOT held behind the existence lookup', () => {
    // `needsIssue` is false here, so 'unverified' is irrelevant and the gate
    // must not invent a reason to stay closed.
    const gate = approveGate(row({ type: 'ceiling_stop', context: {} }), 'unverified')
    expect(gate.enabled).toBe(true)
    expect(gate.block).toBeNull()
  })

  it('NO_REGISTERED_EFFECT: still no button at all — but now it says why', () => {
    const r = row({ type: 'something_nobody_registered', context: {} })
    const gate = approveGate(r, NO_ISSUE)
    expect(oldButtonRendered(r)).toBe(false)   // unchanged: this one was already right
    expect(gate.label).toBeNull()
    expect(gate.enabled).toBe(false)
    expect(gate.block).toBe('NO_REGISTERED_EFFECT')
    expect(gate.reason).toContain('No automated effect is registered')
  })

  it('THE WORKING CASE: a clean row keeps its live button and describeApproval’s label', () => {
    const r = row({})
    const gate = approveGate(r, { issueExists: true, issueRef: 'issue-uuid-1' })
    expect(gate.enabled).toBe(true)
    expect(gate.reason).toBeNull()
    expect(gate.block).toBeNull()
    expect(gate.label).toBe('Approve — un-pause builder and unblock issue-uuid-1')
  })

  it('ALREADY_RESOLVED: a re-decision is refused here too, not only at the API', () => {
    const r = row({ status: 'approved', resolved_by: 'kaos', resolved_at: '2026-08-26T00:00:00.000Z' })
    const gate = approveGate(r, { issueExists: true, issueRef: 'issue-uuid-1' })
    expect(gate.enabled).toBe(false)
    expect(gate.block).toBe('ALREADY_RESOLVED')
  })
})
