/**
 * lib/__tests__/approvals-role-source.test.ts — where the role comes from.
 *
 * WHAT THIS PINS, and why it is a separate file from approvals-actor.test.ts.
 *
 * `approvals-actor.test.ts` proves what a given ROLE may do. It says nothing
 * about where that role came from, and that turned out to be the whole hole.
 * Wave 8's route resolved its actor with `lib/with-permission.ts`'s
 * `resolveRole()`, which accepts ANY valid session password and then reads the
 * role straight out of the client-typed `mc-role` cookie. A fresh critic
 * measured the consequence live, twice, with the cookie as the only variable:
 *
 *     mc-auth=view2026; mc-role=viewer  ->  403 PERMISSION_DENIED
 *     mc-auth=view2026; mc-role=admin   ->  200, agent released,
 *                                            trail records "michael (admin)"
 *
 * `view2026` is the READ-ONLY viewer password. Every refusal the piece
 * demonstrated was bypassable by editing one cookie value, and the
 * append-only audit trail was recording the escalation as an admin decision.
 *
 * `resolveDecisionRole()` closes it: the role comes from the CREDENTIAL, and
 * `mc-role` may only narrow it. Narrowing is honoured because asking to be
 * treated as less is fail-safe; widening is ignored and reported.
 */

import { resolveDecisionRole, type SessionCredentials } from '@/lib/approvals'

const CREDS: SessionCredentials = {
  ownerPassword: 'owner-secret',
  viewerPassword: 'viewer-secret',
  memberPassword: 'member-secret',
}

function req(sessionPassword: string | null, claimedRole: string | null, agentRoleHeader: string | null = null) {
  return { sessionPassword, claimedRole, agentRoleHeader }
}

describe('the role comes from the credential, not the cookie', () => {
  it('THE ESCALATION IS CLOSED: the viewer password cannot name itself admin', () => {
    const r = resolveDecisionRole(req(CREDS.viewerPassword, 'admin'), CREDS)
    expect(r.role).toBe('viewer')
    expect(r.granted).toBe('viewer')
    expect(r.ignoredClaim).toBe('admin')
  })

  it('nor owner, nor member, nor god — every widening is ignored the same way', () => {
    for (const claim of ['owner', 'member', 'god', 'tron', 'defaultbot']) {
      const r = resolveDecisionRole(req(CREDS.viewerPassword, claim), CREDS)
      expect(r.role).toBe('viewer')
      expect(r.ignoredClaim).toBe(claim)
    }
  })

  it('the same viewer credential asking for viewer is unchanged — the fix is not a blanket downgrade', () => {
    const r = resolveDecisionRole(req(CREDS.viewerPassword, 'viewer'), CREDS)
    expect(r).toEqual({ role: 'viewer', granted: 'viewer', ignoredClaim: null })
  })

  it('the owner password grants owner, which is what app/api/auth/route.ts signs you in as', () => {
    // That route maps MC_PASSWORD -> role 'owner' and writes mc-role=owner.
    // Deriving the role from the credential means using THAT mapping rather
    // than inventing a second one.
    const r = resolveDecisionRole(req(CREDS.ownerPassword, 'owner'), CREDS)
    expect(r).toEqual({ role: 'owner', granted: 'owner', ignoredClaim: null })
  })

  it('an owner session may narrow itself, and narrowing is not reported as an ignored claim', () => {
    // `admin` holds nothing `owner` does not, so this is a request to be
    // treated as less. Honouring it is fail-safe.
    expect(resolveDecisionRole(req(CREDS.ownerPassword, 'admin'), CREDS))
      .toEqual({ role: 'admin', granted: 'owner', ignoredClaim: null })
    expect(resolveDecisionRole(req(CREDS.ownerPassword, 'viewer'), CREDS))
      .toEqual({ role: 'viewer', granted: 'owner', ignoredClaim: null })
  })

  it('a member credential is a member, and cannot claim its way up', () => {
    expect(resolveDecisionRole(req(CREDS.memberPassword!, 'member'), CREDS).role).toBe('member')
    const up = resolveDecisionRole(req(CREDS.memberPassword!, 'owner'), CREDS)
    expect(up.role).toBe('member')
    expect(up.ignoredClaim).toBe('owner')
  })

  it('a missing or unreadable mc-role cookie leaves the credential standing — never an upgrade', () => {
    for (const cookie of [null, '', '   ', 'ADMIN', 'root', 'superuser']) {
      const r = resolveDecisionRole(req(CREDS.viewerPassword, cookie), CREDS)
      expect(r.role).toBe('viewer')
      // Unrecognised is not the same as rejected-widening: nothing was asked
      // for that could be granted, so there is nothing to report.
      expect(r.ignoredClaim).toBeNull()
    }
  })

  it('an unrecognised password proves nothing, whatever the cookie says', () => {
    expect(resolveDecisionRole(req('not-a-password', 'owner'), CREDS))
      .toEqual({ role: null, granted: null, ignoredClaim: null })
    expect(resolveDecisionRole(req(null, 'admin'), CREDS))
      .toEqual({ role: null, granted: null, ignoredClaim: null })
  })

  it('an unconfigured password can never be matched by an empty credential', () => {
    // MC_MEMBER_PASSWORD is unset on this install. If the empty string were
    // allowed to match, a request with no mc-auth cookie would resolve to
    // `member` — absence of configuration granting access is the exact bug
    // lib/internal-auth.ts exists to avoid.
    const noMember: SessionCredentials = { ...CREDS, memberPassword: null }
    expect(resolveDecisionRole(req('', 'member'), noMember).role).toBeNull()
    expect(resolveDecisionRole(req(null, 'member'), noMember).role).toBeNull()
  })

  it('X-Agent-Role is honoured ONLY when no session is presented', () => {
    // Agent callers carry no session cookie, and middleware.ts already makes
    // them prove themselves with the internal secret before they get here.
    expect(resolveDecisionRole(req(null, null, 'member'), CREDS).role).toBe('member')
    // With a session, the header is ignored entirely — the spoof protection
    // lib/with-permission.ts also has, kept.
    expect(resolveDecisionRole(req(CREDS.viewerPassword, null, 'owner'), CREDS).role).toBe('viewer')
    expect(resolveDecisionRole(req(CREDS.viewerPassword, 'viewer', 'owner'), CREDS).role).toBe('viewer')
  })

  it('an unrecognised X-Agent-Role grants nothing', () => {
    expect(resolveDecisionRole(req(null, null, 'superuser'), CREDS).role).toBeNull()
  })
})
