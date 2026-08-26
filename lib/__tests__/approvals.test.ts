// lib/__tests__/approvals.test.ts — approval-surface piece (Wave 6)
//
// The bias of this file is deliberate: most of it proves that the approval
// path REFUSES. A test suite that only shows the happy path passing cannot
// tell a working guard from a deleted one, and every one of the four
// behaviours below used to be a clean 2xx success:
//
//   * approving a request whose target issue has been deleted
//   * approving a request type nothing can dispatch
//   * re-deciding a request that was already decided (overwriting the record)
//   * approving an un-pause with no agent to un-pause
//
// Each refusal test is paired with a "and the same input is ALLOWED once the
// one thing that made it unsafe is fixed" assertion, so a guard that refuses
// everything unconditionally fails just as loudly as one that refuses nothing.

import {
  approvalTarget,
  auditRowForOutcome,
  auditRowForRefusal,
  describeApproval,
  hasRegisteredEffect,
  humanReason,
  issueRefsToResolve,
  preflightDecision,
  resolveRowProject,
  scopeToProject,
  EFFECT_TYPES,
  type ApprovalRow,
} from '../approvals'

/** A pending loop-breaker request pointing at a real issue. */
function loopBreakerRow(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'inbox-1',
    agent: 'builder',
    type: 'loop_breaker_pause',
    status: 'pending',
    context: { last_issue_id: 'issue-uuid-1', task_key: 'TOD-9001', agent_id: 'builder' },
    ...over,
  }
}

/** A pending ceiling-stop request naming an issue by task key. */
function ceilingRow(over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'inbox-2',
    agent: 'ops',
    type: 'ceiling_stop',
    status: 'pending',
    context: { task_key: 'TOD-9002' },
    ...over,
  }
}

const EXISTS = { issueExists: true as boolean | null, issueRef: 'TOD-9001' }
const GONE = { issueExists: false as boolean | null, issueRef: 'TOD-9001' }
const NO_TARGET = { issueExists: null as boolean | null, issueRef: null }

// ─── A. The item says what it is ───────────────────────────────────────────

describe('describeApproval — an approve button that does not say what it approves', () => {
  it('fills every field a human needs, with no blanks', () => {
    const d = describeApproval(loopBreakerRow())
    for (const key of ['question', 'agent', 'ifApproved', 'ifRefused', 'refuseLabel', 'confirmRefuseLabel'] as const) {
      expect(typeof d[key]).toBe('string')
      expect(d[key]).not.toBe('')
    }
    expect(d.approveLabel).toBeTruthy()
  })

  it('names BOTH halves of the loop-breaker effect when there is an issue', () => {
    const d = describeApproval(loopBreakerRow())
    expect(d.approveLabel).toContain('builder')
    expect(d.approveLabel).toContain('TOD-9001')
    expect(d.ifApproved).toContain('TOD-9001')
  })

  it('does NOT claim an issue will be unblocked when the request carries none', () => {
    const d = describeApproval(loopBreakerRow({ context: { agent_id: 'builder' } }))
    expect(d.approveLabel).toContain('builder')
    expect(d.approveLabel).not.toMatch(/unblock/i)
    expect(d.ifApproved).toMatch(/nothing is unblocked/i)
  })

  it('gives the confirming click its own label rather than composing a double dash', () => {
    // "Confirm — " + "Refuse — leave it stopped" rendered as
    // "Confirm — Refuse — leave it stopped" in the browser. One dash.
    const d = describeApproval(loopBreakerRow())
    expect(d.confirmRefuseLabel.match(/—/g) ?? []).toHaveLength(1)
    expect(d.confirmRefuseLabel).toContain('builder')
  })

  it('says what refusing leaves in place, not just that it was refused', () => {
    const d = describeApproval(loopBreakerRow())
    expect(d.ifRefused).toMatch(/stays paused/i)
    expect(d.ifRefused).toContain('TOD-9001')
  })

  it('offers NO approve button for a type with no registered effect', () => {
    const d = describeApproval({
      id: 'inbox-x', agent: 'scout', type: 'weekly_summary', status: 'pending', context: null,
    })
    expect(d.hasRegisteredEffect).toBe(false)
    expect(d.approveLabel).toBeNull()
    expect(d.ifApproved).toMatch(/nothing/i)
    // Refusing/acknowledging is still on the table — that is always safe.
    expect(d.refuseLabel).not.toBe('')
    expect(d.confirmRefuseLabel).not.toBe('')
  })

  it('never renders a blank agent, even on a row with no agent at all', () => {
    const d = describeApproval({ id: 'i', agent: null, type: 'ceiling_stop', status: 'pending', context: null })
    expect(d.agent).toBe('an unnamed agent')
    expect(d.question).toContain('an unnamed agent')
  })

  it('hasRegisteredEffect agrees with the exported type list', () => {
    expect([...EFFECT_TYPES].sort()).toEqual(['ceiling_stop', 'loop_breaker_pause'])
    for (const t of EFFECT_TYPES) expect(hasRegisteredEffect(t)).toBe(true)
    expect(hasRegisteredEffect('weekly_summary')).toBe(false)
    expect(hasRegisteredEffect(null)).toBe(false)
  })
})

describe('approvalTarget', () => {
  it('prefers inbox.agent, falling back to context.agent_id', () => {
    expect(approvalTarget(loopBreakerRow()).agentId).toBe('builder')
    expect(approvalTarget(loopBreakerRow({ agent: null })).agentId).toBe('builder')
    expect(approvalTarget(loopBreakerRow({ agent: null, context: { last_issue_id: 'x' } })).agentId).toBeNull()
  })

  it('marks needsIssue only when approving would actually touch an issue', () => {
    expect(approvalTarget(loopBreakerRow()).needsIssue).toBe(true)
    expect(approvalTarget(loopBreakerRow({ context: { agent_id: 'builder' } })).needsIssue).toBe(false)
    expect(approvalTarget(ceilingRow()).needsIssue).toBe(true)
    expect(approvalTarget(ceilingRow({ context: {} })).needsIssue).toBe(false)
  })
})

// ─── D. Fail closed — the four refusals ────────────────────────────────────

describe('preflightDecision REFUSES (each of these used to be a clean success)', () => {
  it('1. refuses an approval whose target issue no longer exists', () => {
    const r = preflightDecision({ row: loopBreakerRow(), decision: 'approved', lookup: GONE })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('TARGET_MISSING')
    expect(r.httpStatus).toBe(409)
    expect(r.reason).toContain('TOD-9001')
    expect(r.reason).toMatch(/no longer exists/i)
  })

  it('   …and ALLOWS the identical request once the issue is there', () => {
    expect(preflightDecision({ row: loopBreakerRow(), decision: 'approved', lookup: EXISTS }).ok).toBe(true)
  })

  it('   …and still allows REFUSING it — refusal is always safe', () => {
    expect(preflightDecision({ row: loopBreakerRow(), decision: 'denied', lookup: GONE }).ok).toBe(true)
    expect(preflightDecision({ row: loopBreakerRow(), decision: 'explained', lookup: GONE }).ok).toBe(true)
  })

  it('2. refuses approving a type nothing can dispatch', () => {
    const row: ApprovalRow = { id: 'i', agent: 'scout', type: 'weekly_summary', status: 'pending', context: null }
    const r = preflightDecision({ row, decision: 'approved', lookup: NO_TARGET })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('NO_REGISTERED_EFFECT')
    expect(r.httpStatus).toBe(422)
    expect(r.reason).toContain('weekly_summary')
  })

  it('   …but acknowledging that same type is allowed', () => {
    const row: ApprovalRow = { id: 'i', agent: 'scout', type: 'weekly_summary', status: 'pending', context: null }
    expect(preflightDecision({ row, decision: 'explained', lookup: NO_TARGET }).ok).toBe(true)
    expect(preflightDecision({ row, decision: 'denied', lookup: NO_TARGET }).ok).toBe(true)
  })

  it('3. refuses re-deciding a request that was already decided', () => {
    const row = loopBreakerRow({ status: 'approved', resolved_by: 'michael', resolved_at: '2026-08-25T10:00:00Z' })
    const r = preflightDecision({ row, decision: 'denied', lookup: EXISTS })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('ALREADY_RESOLVED')
    expect(r.httpStatus).toBe(409)
    // The refusal must say what the standing decision WAS — otherwise the
    // operator cannot tell whether their own click landed earlier.
    expect(r.reason).toContain('michael')
    expect(r.reason).toContain('approved')
  })

  it('   …and the same row while still pending is allowed', () => {
    expect(preflightDecision({ row: loopBreakerRow(), decision: 'denied', lookup: EXISTS }).ok).toBe(true)
  })

  it('4. refuses an un-pause with no agent to un-pause', () => {
    const row = loopBreakerRow({ agent: null, context: { last_issue_id: 'issue-uuid-1' } })
    const r = preflightDecision({ row, decision: 'approved', lookup: EXISTS })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('NO_AGENT')
    expect(r.httpStatus).toBe(409)
  })

  it('   …ceiling_stop does not require an agent, and is allowed without one', () => {
    const row = ceilingRow({ agent: null })
    expect(preflightDecision({ row, decision: 'approved', lookup: EXISTS }).ok).toBe(true)
  })

  it('refuses a status this surface cannot record at all', () => {
    const r = preflightDecision({ row: loopBreakerRow(), decision: 'yolo', lookup: EXISTS })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('UNKNOWN_STATUS')
    expect(r.httpStatus).toBe(400)
  })

  it('does not treat "no issue to look up" as "the issue is gone"', () => {
    // needsIssue is false here, so a null lookup must NOT refuse.
    const row = loopBreakerRow({ context: { agent_id: 'builder' } })
    expect(preflightDecision({ row, decision: 'approved', lookup: NO_TARGET }).ok).toBe(true)
  })
})

// ─── C. Scope refuses rather than widens ───────────────────────────────────

describe('resolveRowProject / scopeToProject', () => {
  const map = new Map<string, string>([
    ['issue-uuid-1', 'Limiglow'],
    ['TOD-9002', 'Otherco'],
  ])

  it('prefers an explicit context.project', () => {
    const row = loopBreakerRow({ context: { project: 'Explicit', last_issue_id: 'issue-uuid-1' } })
    expect(resolveRowProject(row, map)).toBe('Explicit')
  })

  it('falls back to the project of the issue the request points at', () => {
    expect(resolveRowProject(loopBreakerRow(), map)).toBe('Limiglow')
    expect(resolveRowProject(ceilingRow(), map)).toBe('Otherco')
  })

  it('returns null — not a guess — when the request cannot be placed', () => {
    const row: ApprovalRow = { id: 'i', agent: 'a', type: 'weekly_summary', status: 'pending', context: {} }
    expect(resolveRowProject(row, map)).toBeNull()
  })

  it('EXCLUDES unplaceable rows from a scoped list instead of widening', () => {
    const unplaceable: ApprovalRow = { id: 'i3', agent: 'a', type: 'weekly_summary', status: 'pending', context: {} }
    const out = scopeToProject([loopBreakerRow(), ceilingRow(), unplaceable], 'Limiglow', map)
    expect(out.rows.map(r => r.id)).toEqual(['inbox-1'])
    expect(out.scope).toEqual({ project: 'Limiglow', matched: 1, other_project: 1, unresolvable: 1 })
  })

  it('the three scope counts always account for every row examined', () => {
    const rows = [loopBreakerRow(), ceilingRow(), { id: 'z', agent: null, type: null, status: 'pending', context: null }]
    const { scope } = scopeToProject(rows, 'Limiglow', map)
    expect(scope.matched + scope.other_project + scope.unresolvable).toBe(rows.length)
  })

  it('matches the project case-insensitively (URL says limiglow, the row says Limiglow)', () => {
    expect(scopeToProject([loopBreakerRow()], 'limiglow', map).rows).toHaveLength(1)
  })

  it('asks for exactly the issue refs it cannot place without a lookup', () => {
    const explicit = loopBreakerRow({ id: 'e', context: { project: 'Limiglow', last_issue_id: 'skip-me' } })
    const refs = issueRefsToResolve([loopBreakerRow(), ceilingRow(), explicit])
    expect(refs.ids).toEqual(['issue-uuid-1'])
    expect(refs.taskKeys.sort()).toEqual(['TOD-9001', 'TOD-9002'])
    // A row already placeable by context.project costs no lookup.
    expect(refs.ids).not.toContain('skip-me')
  })
})

// ─── E. The audit row records what happened, not what was asked for ────────

describe('auditRowForOutcome', () => {
  const base = {
    row: loopBreakerRow(),
    humanInput: { reason: 'go ahead' },
    project: 'Limiglow',
    decidedBy: 'michael',
    decidedAt: '2026-08-25T12:00:00Z',
  }

  it('records an effect that FAILED as failed, not as an applied approval', () => {
    const r = auditRowForOutcome({
      ...base, decision: 'approved',
      effect: { effect: 'agent_unpause', ok: false, detail: 'un-pause failed: boom' },
    })
    expect(r.outcome).toBe('failed')
    expect(r.detail).toContain('boom')
    expect(r.decision).toBe('approved')
  })

  it('records a successful effect as applied', () => {
    const r = auditRowForOutcome({
      ...base, decision: 'approved',
      effect: { effect: 'agent_unpause', ok: true, detail: "agent 'builder' un-paused" },
    })
    expect(r.outcome).toBe('applied')
    expect(r.effect).toBe('agent_unpause')
  })

  it("records a denial's no-op as no_effect, and keeps the human's reason separate from the detail", () => {
    const r = auditRowForOutcome({
      ...base, decision: 'denied',
      humanInput: { reason: 'too expensive' },
      effect: { effect: 'none', ok: true, detail: 'denied — agent remains paused (too expensive)' },
    })
    expect(r.outcome).toBe('no_effect')
    expect(r.human_reason).toBe('too expensive')
    expect(r.detail).toContain('remains paused')
  })

  it('never invents a project for an unplaceable request', () => {
    const r = auditRowForOutcome({ ...base, project: null, decision: 'denied', effect: null })
    expect(r.project).toBeNull()
  })
})

describe('auditRowForRefusal', () => {
  it('files a refusal as a real audit row, with the refusal code and reason', () => {
    const refusal = preflightDecision({ row: loopBreakerRow(), decision: 'approved', lookup: GONE })
    if (refusal.ok) throw new Error('expected a refusal')
    const r = auditRowForRefusal({
      row: loopBreakerRow(), decision: 'approved', refusal,
      humanInput: undefined, project: 'Limiglow', decidedBy: 'michael', decidedAt: '2026-08-25T12:00:00Z',
    })
    expect(r.outcome).toBe('refused')
    expect(r.effect).toBe('TARGET_MISSING')
    expect(r.detail).toMatch(/no longer exists/i)
    expect(r.decision).toBe('approved')
    expect(r.human_reason).toBeNull()
  })
})

describe('humanReason', () => {
  it('reads a typed reason and ignores everything else', () => {
    expect(humanReason({ reason: '  spaced  ' })).toBe('spaced')
    expect(humanReason({ reason: '   ' })).toBeNull()
    expect(humanReason({ other: 'x' })).toBeNull()
    expect(humanReason(null)).toBeNull()
    expect(humanReason('a string')).toBeNull()
    expect(humanReason([{ reason: 'x' }])).toBeNull()
  })
})

// ─── A request TYPE is free text, and it reached a prototype lookup ──────────
//
// ADDED 2026-08-26 (round 3). `inbox.type` is a plain TEXT column
// (migrations/011_inbox.sql — no CHECK, no FK), so any caller that may file a
// request chooses the string. `APPROVAL_KINDS` is an object literal, and the
// three lookups into it were bare `APPROVAL_KINDS[type]`, which finds
// `Object.prototype` members: `APPROVAL_KINDS['constructor']` is the `Object`
// constructor — truthy — and the next line calls `kind.touchesIssue(...)` on
// it, which is a TypeError, which is an empty HTTP 500.
//
// MEASURED end to end on the running dev server before the fix:
//
//   POST /api/inbox {"agent":"…","type":"constructor","project":"Limiglow"} -> 201
//   GET  /api/inbox?project=Limiglow                                        -> 500 (empty body)
//   PATCH /api/inbox {"id":…,"status":"approved","resolved_by":"michael"}   -> 500 (empty body)
//   DELETE that one row                                                     -> queue 200 again
//
// One accepted request took the whole project's approval queue offline for
// everyone — including for the operator trying to look at it in order to
// clear it. That is a denial of service on the human-in-the-loop, reachable
// by anything that can file a request, and it is the most expensive possible
// reading of "an unknown type is refused".
//
// These cases are generated from `Object.getOwnPropertyNames(Object.prototype)`
// rather than listing the names that were found, so the class stays closed.
describe('a request type that names an Object.prototype member', () => {
  const PROTO_KEYS = Object.getOwnPropertyNames(Object.prototype)

  function protoRow(type: string) {
    return {
      id: 'ib-proto',
      agent: 'lane5-proto-agent',
      type,
      context: { agent_id: 'lane5-proto-agent' },
      status: 'pending',
    }
  }

  it('has something to test', () => {
    expect(PROTO_KEYS).toEqual(expect.arrayContaining(['constructor', 'toString', '__proto__']))
  })

  it('describeApproval does not throw, and renders NO approve button', () => {
    for (const key of PROTO_KEYS) {
      const d = describeApproval(protoRow(key))
      expect(d.hasRegisteredEffect).toBe(false)
      // The whole point of `approveLabel: null` — no button that resolves to
      // "recorded as approved, nothing happened".
      expect(d.approveLabel).toBeNull()
      expect(d.refuseLabel).toBeTruthy()
    }
  })

  it('approvalTarget does not throw and claims no issue', () => {
    for (const key of PROTO_KEYS) {
      const t = approvalTarget(protoRow(key))
      expect(t.needsIssue).toBe(false)
      expect(t.agentId).toBe('lane5-proto-agent')
    }
  })

  it('preflightDecision REFUSES it with 422 NO_REGISTERED_EFFECT, not a 500', () => {
    for (const key of PROTO_KEYS) {
      const r = preflightDecision({
        row: protoRow(key),
        decision: 'approved',
        lookup: { issueExists: null, issueRef: null },
      })
      expect(r.ok).toBe(false)
      expect(r.ok === false && r.code).toBe('NO_REGISTERED_EFFECT')
      expect(r.ok === false && r.httpStatus).toBe(422)
    }
  })

  it('and acknowledging one is still ALLOWED — the refusal is not "refuse everything"', () => {
    for (const key of PROTO_KEYS) {
      expect(preflightDecision({
        row: protoRow(key),
        decision: 'explained',
        lookup: { issueExists: null, issueRef: null },
      })).toEqual({ ok: true })
    }
  })

  it('hasRegisteredEffect is false for every prototype member and true for the real ones', () => {
    for (const key of PROTO_KEYS) expect(hasRegisteredEffect(key)).toBe(false)
    for (const t of EFFECT_TYPES) expect(hasRegisteredEffect(t)).toBe(true)
  })
})
