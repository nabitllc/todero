/**
 * components/tabs/__tests__/inbox-actor-attribution.test.ts — Wave 8,
 * approval surface.
 *
 * WHAT THIS PINS. `approval_decisions.decided_by` holds two different kinds
 * of thing joined into one string by attributeDecision() in lib/approvals.ts:
 * a name the CALLER typed (never verified — Todero has no per-person
 * identity) and a role the SERVER resolved from the request (verified, and
 * the thing the write was actually authorised against).
 *
 * Rendering them as one blob is how the unverified half borrows the
 * authority of the verified one. `splitActor()` is what keeps them apart on
 * screen, and the case that matters most is the LAST one: an audit row
 * written before Wave 8 carries a bare name with no role at all, and must not
 * render as though a role had been checked.
 */

import { splitActor } from '../InboxTab'
import { attributeDecision } from '@/lib/approvals'

describe('splitActor', () => {
  it('separates the claimed name from the proven role', () => {
    expect(splitActor('michael (admin)')).toEqual({ claim: 'michael', role: 'admin' })
  })

  it('round-trips whatever attributeDecision() writes', () => {
    for (const actor of [
      { role: 'admin' as const, claimedBy: 'michael' },
      { role: 'owner' as const, claimedBy: 'definitely-not-a-human-bot' },
      { role: 'viewer' as const, claimedBy: 'someone with spaces' },
    ]) {
      const written = attributeDecision(actor)
      expect(splitActor(written)).toEqual({ claim: actor.claimedBy, role: actor.role })
    }
  })

  it('a role-only attribution reads as the ROLE, with no invented name', () => {
    const written = attributeDecision({ role: 'admin', claimedBy: null })
    expect(written).toBe('admin')
    // CORRECTED 2026-08-26. This case used to expect
    // `{ claim: 'admin', role: null }`, which drove the UI to render amber
    // "· role unverified" with the tooltip "no role was recorded with it".
    // Both halves of that were FALSE for this row: the role WAS resolved and
    // is the only thing recorded. It is live-reachable — PATCH /api/inbox
    // omitting `resolved_by` returns `"resolved_by":"admin"` (measured) — so
    // the old expectation was pinning a lie in place.
    expect(splitActor(written)).toEqual({ claim: null, role: 'admin' })
  })

  it('every role attributeDecision() can write standing alone is read as a role', () => {
    for (const role of ['owner', 'member', 'viewer', 'admin', 'god', 'tron', 'defaultbot'] as const) {
      expect(splitActor(attributeDecision({ role, claimedBy: null })))
        .toEqual({ claim: null, role })
    }
    // And the one it writes for `role: null`. Reading "unauthenticated" as a
    // person's name would be the worst possible misread of that row.
    expect(attributeDecision({ role: null, claimedBy: null })).toBe('unauthenticated')
    expect(splitActor('unauthenticated')).toEqual({ claim: null, role: 'unauthenticated' })
  })

  it('a PRE-Wave-8 row reports role: null so the UI can mark it unverified', () => {
    // This is exactly what the live database holds from before the change —
    // measured 2026-08-26: decided_by "definitely-not-a-human-bot", no role.
    expect(splitActor('definitely-not-a-human-bot')).toEqual({
      claim: 'definitely-not-a-human-bot',
      role: null,
    })
    expect(splitActor('michael')).toEqual({ claim: 'michael', role: null })
  })

  it('a name that merely contains parentheses is not mistaken for a role', () => {
    // Only a trailing "(…)" group is a role. Nested/leading parens are part
    // of the name, and treating them as a role would fabricate a verification
    // that never happened.
    expect(splitActor('michael (test) (admin)')).toEqual({ claim: 'michael (test)', role: 'admin' })
    expect(splitActor('(michael)')).toEqual({ claim: '(michael)', role: null })
  })
})
