// lib/__tests__/approvals-actor.test.ts — approval-surface piece (Wave 8)
//
// lib/__tests__/approvals.test.ts proves the fail-closed half: whether the
// WORLD is in a state where a decision can take effect. This file proves the
// other half, which did not exist before Wave 8: whether the CALLER is
// allowed to make it at all.
//
// WHAT WAS MEASURED FIRST (2026-08-26, live, against the running dev server):
//
//   PATCH /api/inbox
//     {"id":"03cc0798-…","status":"approved",
//      "resolved_by":"definitely-not-a-human-bot"}
//   -> HTTP 200, effect applied, and approval_decisions recorded
//      decided_by:"definitely-not-a-human-bot"
//
// The decision persisted and the effect really ran. What did not happen was
// any check on who made it: the route had no permission logic of its own, and
// `decided_by` was `body.resolved_by ?? 'user'` — a claim, written verbatim.
//
// The bias here matches the sibling file: nearly every test proves a REFUSAL,
// and each refusal is paired with the same input ALLOWED once the single
// thing that made it impermissible is fixed. A gate that refuses everything
// fails these tests exactly as loudly as one that refuses nothing.

import {
  APPROVE_PERMISSION,
  DECIDE_PERMISSION,
  attributeDecision,
  auditRowForRefusal,
  authorizeDecision,
  type ApprovalRow,
} from '../approvals'
import { ROLE_PERMISSIONS, hasPermission } from '../rbac-types'

/** A pending loop-breaker request filed BY the agent it would release. */
function rowFiledBy(agent: string, over: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'inbox-actor-1',
    agent,
    type: 'loop_breaker_pause',
    status: 'pending',
    context: { last_issue_id: 'issue-uuid-1', task_key: 'TOD-9001', agent_id: agent },
    ...over,
  }
}

describe('the permissions this split actually rests on', () => {
  // If these ever stop being true the whole gate degrades silently into a
  // no-op, because every caller would hold both rights. Assert the premise.
  it('member holds the baseline write but NOT the approve right', () => {
    expect(hasPermission('member', DECIDE_PERMISSION)).toBe(true)
    expect(hasPermission('member', APPROVE_PERMISSION)).toBe(false)
  })

  it('admin and owner hold both', () => {
    for (const role of ['admin', 'owner', 'god'] as const) {
      expect(hasPermission(role, DECIDE_PERMISSION)).toBe(true)
      expect(hasPermission(role, APPROVE_PERMISSION)).toBe(true)
    }
  })

  it('viewer holds neither', () => {
    expect(hasPermission('viewer', DECIDE_PERMISSION)).toBe(false)
    expect(hasPermission('viewer', APPROVE_PERMISSION)).toBe(false)
  })

  it('at least one real role is refused approval — otherwise the gate is decorative', () => {
    const refused = (Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>)
      .filter(r => !hasPermission(r, APPROVE_PERMISSION))
    expect(refused.length).toBeGreaterThan(0)
    expect(refused).toContain('member')
  })
})

describe('authorizeDecision — an unattributable decision is refused', () => {
  it('refuses when the request proved no role at all', () => {
    const r = authorizeDecision({
      actor: { role: null, claimedBy: 'michael' },
      row: rowFiledBy('builder'),
      decision: 'approved',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('NO_ACTOR')
    expect(r.httpStatus).toBe(403)
    // Claiming a name must not be a way around having no role.
    expect(r.reason).toMatch(/attributable to nobody/i)
  })

  it('a claimed name does not substitute for a role, even a plausible one', () => {
    for (const claim of ['michael', 'owner', 'admin', 'god']) {
      const r = authorizeDecision({
        actor: { role: null, claimedBy: claim },
        row: rowFiledBy('builder'),
        decision: 'denied',
      })
      expect(r.ok).toBe(false)
    }
  })
})

describe('authorizeDecision — approving is a different right from filing', () => {
  const row = rowFiledBy('builder')

  it('refuses a member (the drafting-agent role) attempting to APPROVE', () => {
    const r = authorizeDecision({
      actor: { role: 'member', claimedBy: 'builder-bot' },
      row,
      decision: 'approved',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('PERMISSION_DENIED')
    expect(r.httpStatus).toBe(403)
    expect(r.required).toBe(APPROVE_PERMISSION)
  })

  it('…and ALLOWS that same member to deny or acknowledge the same row', () => {
    // The asymmetry is the safety property: refusing only ever leaves the
    // agent stopped, so it is never the dangerous direction.
    for (const decision of ['denied', 'explained', 'timeout']) {
      const r = authorizeDecision({
        actor: { role: 'member', claimedBy: 'builder-bot' },
        row,
        decision,
      })
      expect(r).toEqual({ ok: true })
    }
  })

  it('…and ALLOWS an admin to approve the identical row, changing only the role', () => {
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: 'michael' },
      row,
      decision: 'approved',
    })
    expect(r).toEqual({ ok: true })
  })

  it('refuses a viewer on every decision, including a denial', () => {
    for (const decision of ['approved', 'denied', 'explained', 'timeout']) {
      const r = authorizeDecision({
        actor: { role: 'viewer', claimedBy: 'michael' },
        row,
        decision,
      })
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.required).toBe(DECIDE_PERMISSION)
    }
  })

  it('refuses defaultbot and tron on approval — they file work, they do not release it', () => {
    for (const role of ['defaultbot', 'tron'] as const) {
      const r = authorizeDecision({ actor: { role, claimedBy: 'bot' }, row, decision: 'approved' })
      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('unreachable')
      expect(r.code).toBe('PERMISSION_DENIED')
    }
  })
})

describe('authorizeDecision — no agent approves its own request', () => {
  it('refuses an approval signed with the name on inbox.agent', () => {
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: 'builder' },
      row: rowFiledBy('builder'),
      decision: 'approved',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('SELF_APPROVAL')
    expect(r.httpStatus).toBe(403)
  })

  it('refuses it when the name is only in context.agent_id, not on the column', () => {
    const row: ApprovalRow = {
      id: 'inbox-actor-2',
      agent: null,
      type: 'ceiling_stop',
      status: 'pending',
      context: { agent_id: 'spend-bot', task_key: 'TOD-9002' },
    }
    const r = authorizeDecision({
      actor: { role: 'owner', claimedBy: 'Spend-Bot' }, // case must not be an escape hatch
      row,
      decision: 'approved',
    })
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.code).toBe('SELF_APPROVAL')
  })

  it('surrounding whitespace is not an escape hatch either', () => {
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: '  builder  ' },
      row: rowFiledBy('builder'),
      decision: 'approved',
    })
    expect(r.ok).toBe(false)
  })

  it('…and ALLOWS the same admin session under any other name', () => {
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: 'michael' },
      row: rowFiledBy('builder'),
      decision: 'approved',
    })
    expect(r).toEqual({ ok: true })
  })

  it('…and ALLOWS the requesting agent to DENY its own request', () => {
    // Standing down is always permitted; only release is gated.
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: 'builder' },
      row: rowFiledBy('builder'),
      decision: 'denied',
    })
    expect(r).toEqual({ ok: true })
  })

  it('an approval with no claimed name at all is allowed on the role alone', () => {
    // Nothing to collide with; the role is still recorded by attributeDecision.
    const r = authorizeDecision({
      actor: { role: 'admin', claimedBy: null },
      row: rowFiledBy('builder'),
      decision: 'approved',
    })
    expect(r).toEqual({ ok: true })
  })
})

describe('attributeDecision — the claim and the proof stay distinguishable', () => {
  it('records the claimed name AND the role the server resolved', () => {
    expect(attributeDecision({ role: 'admin', claimedBy: 'michael' })).toBe('michael (admin)')
  })

  it('falls back to the role alone rather than to "user"', () => {
    expect(attributeDecision({ role: 'admin', claimedBy: null })).toBe('admin')
    expect(attributeDecision({ role: 'admin', claimedBy: '   ' })).toBe('admin')
  })

  it('never writes a claim without the role beside it', () => {
    // The exact defect measured live: "definitely-not-a-human-bot" alone.
    const written = attributeDecision({ role: 'admin', claimedBy: 'definitely-not-a-human-bot' })
    expect(written).not.toBe('definitely-not-a-human-bot')
    expect(written).toBe('definitely-not-a-human-bot (admin)')
  })

  it('an unauthenticated actor is named as such, not silently as "user"', () => {
    expect(attributeDecision({ role: null, claimedBy: null })).toBe('unauthenticated')
    expect(attributeDecision({ role: null, claimedBy: 'michael' })).toBe('michael (unauthenticated)')
  })
})

describe('a refused actor still lands in the append-only trail', () => {
  it('records outcome=refused with the refusal code as the effect', () => {
    const row = rowFiledBy('builder')
    const refusal = authorizeDecision({
      actor: { role: 'member', claimedBy: 'builder-bot' },
      row,
      decision: 'approved',
    })
    expect(refusal.ok).toBe(false)
    if (refusal.ok) throw new Error('unreachable')

    const audit = auditRowForRefusal({
      row,
      decision: 'approved',
      refusal,
      humanInput: { reason: 'trying to release myself' },
      project: 'Limiglow',
      decidedBy: attributeDecision({ role: 'member', claimedBy: 'builder-bot' }),
      decidedAt: '2026-08-26T00:00:00.000Z',
    })

    expect(audit.outcome).toBe('refused')
    expect(audit.effect).toBe('PERMISSION_DENIED')
    expect(audit.decision).toBe('approved')
    expect(audit.decided_by).toBe('builder-bot (member)')
    expect(audit.human_reason).toBe('trying to release myself')
    expect(audit.inbox_id).toBe(row.id)
    // The detail must carry the server's own reason, not a generic string —
    // a refusal nobody can read afterwards is barely better than a silence.
    expect(audit.detail).toBe(refusal.reason)
  })
})
