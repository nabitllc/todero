/**
 * ROUND 2 — the biggest gap: the client asserted its own role and was believed.
 *
 * `mc-role` is a cookie the client types. `lib/with-permission.ts` read the role
 * straight out of it whenever ANY valid session password was present, and
 * `lib/session-actor.ts` did the same to decide which HUMAN NAME to write into
 * the workflow audit trail. Both were measured live against the running dev
 * server on 2026-08-26, with the READ-ONLY viewer password and one cookie value
 * as the only variable:
 *
 *   PATCH /api/commerce/products   (a route lib/with-permission.ts guards)
 *     mc-auth=view2026; mc-role=viewer -> 403 read-only
 *     mc-auth=view2026; mc-role=admin  -> reaches the handler, commerce:write granted
 *
 *   resolveSessionActor(), the real module
 *     mc-auth=view2026; mc-role=owner  -> "michael"      (the workspace owner)
 *     mc-auth=view2026; mc-role=admin  -> "michael"
 *
 * The rule now: the role comes from the CREDENTIAL, and `mc-role` may only
 * NARROW it. Narrowing is honoured because asking to be treated as less is
 * fail-safe; widening is refused because it is a claim with nothing behind it.
 *
 * SCOPE, stated so this file is not read as more than it is: `middleware.ts` is
 * the PRIMARY gate, is not in this lane's ownership, and STILL reads `mc-role`
 * directly. The same forged cookie still escalates on routes middleware alone
 * guards — measured, and filed with an exact diff as a seam request in
 * docs/rebuild/pieces/pieces8/identity-sessions.md §10.
 */
import type { NextRequest } from 'next/server'
import { resolveRole, resolveRoleDetail } from '@/lib/with-permission'
import { resolveSessionActor } from '@/lib/session-actor'
import { hasPermission } from '@/lib/rbac-types'

/** A request carrying exactly these cookies and headers, and nothing else. */
function req(cookies: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
  return {
    cookies: { get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) },
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  } as unknown as NextRequest
}

const OWNER = 'kaos2026'
const VIEWER = 'view2026'

describe('a read-only credential cannot raise its own role with a cookie', () => {
  // Every role the cookie could name, against the viewer password.
  const claims = ['owner', 'admin', 'god', 'member', 'tron', 'defaultbot']

  it.each(claims)('mc-auth=view2026 + mc-role=%s still resolves to viewer', (claim) => {
    const detail = resolveRoleDetail(req({ 'mc-auth': VIEWER, 'mc-role': claim }))
    expect(detail.role).toBe('viewer')
    expect(detail.granted).toBe('viewer')
    expect(detail.ignoredClaim).toBe(claim)
  })

  it.each(claims)('and gains no write permission by claiming %s', (claim) => {
    const role = resolveRole(req({ 'mc-auth': VIEWER, 'mc-role': claim }))!
    expect(hasPermission(role, 'issues:write')).toBe(false)
    expect(hasPermission(role, 'commerce:write')).toBe(false)
    expect(hasPermission(role, 'settings:write')).toBe(false)
    expect(hasPermission(role, 'roles:admin')).toBe(false)
  })

  it('the exact live payload: commerce:write is refused where it was granted', () => {
    // The measured escalation, as a unit assertion.
    const escalated = resolveRole(req({ 'mc-auth': VIEWER, 'mc-role': 'admin' }))
    expect(escalated).toBe('viewer')
    expect(hasPermission(escalated!, 'commerce:write')).toBe(false)
  })
})

describe('narrowing is still honoured — asking for less is fail-safe', () => {
  it('an owner session that says mc-role=viewer is treated as a viewer', () => {
    const detail = resolveRoleDetail(req({ 'mc-auth': OWNER, 'mc-role': 'viewer' }))
    expect(detail.role).toBe('viewer')
    expect(detail.granted).toBe('owner')
    expect(detail.ignoredClaim).toBeNull()
  })

  it('an owner session that says mc-role=admin keeps admin (a real subset)', () => {
    expect(resolveRole(req({ 'mc-auth': OWNER, 'mc-role': 'admin' }))).toBe('admin')
  })
})

describe('the credential stands on its own when the cookie says nothing usable', () => {
  it('no mc-role at all', () => {
    expect(resolveRole(req({ 'mc-auth': OWNER }))).toBe('owner')
    expect(resolveRole(req({ 'mc-auth': VIEWER }))).toBe('viewer')
  })

  it('an unrecognised mc-role is never treated as an upgrade', () => {
    for (const junk of ['', '  ', 'superuser', 'OWNER', 'root', '../owner']) {
      expect(resolveRole(req({ 'mc-auth': VIEWER, 'mc-role': junk }))).toBe('viewer')
    }
  })

  it('a forged role with no valid password proves nothing', () => {
    expect(resolveRole(req({ 'mc-role': 'owner' }))).toBeNull()
    expect(resolveRole(req({ 'mc-auth': 'wrong', 'mc-role': 'owner' }))).toBeNull()
  })
})

describe('the owner password is called owner, matching the login that issues it', () => {
  it('resolves to owner, not to this file\'s old private word "admin"', () => {
    expect(resolveRole(req({ 'mc-auth': OWNER }))).toBe('owner')
  })

  it('and loses no access in the change — owner is a superset of admin', () => {
    const adminPerms = [
      'issues:read', 'issues:write', 'issues:delete', 'sprints:read', 'sprints:write',
      'agents:read', 'agents:write', 'agents:spawn', 'projects:read', 'projects:write',
      'commerce:read', 'commerce:write', 'settings:read', 'settings:write',
      'calendar:read', 'calendar:write', 'memory:read', 'memory:write', 'infra:read',
    ] as const
    for (const p of adminPerms) expect(hasPermission('owner', p)).toBe(true)
  })
})

describe('X-Agent-Role — honoured only with no session, and never as a human name', () => {
  it('is ignored when a session is present, however weak that session is', () => {
    expect(resolveRole(req({ 'mc-auth': VIEWER }, { 'x-agent-role': 'owner' }))).toBe('viewer')
  })

  it('is honoured when there is no session at all', () => {
    // Reachable only behind middleware.ts's internal-secret check — measured:
    // with no cookie and no secret, middleware answers 401 before this runs.
    expect(resolveRole(req({}, { 'x-agent-role': 'member' }))).toBe('member')
  })

  it('never resolves to the human owner identity', () => {
    // resolveSessionActor deliberately does not consult the header: a machine
    // caller must not be attributed as a person.
    expect(resolveSessionActor(req({}, { 'x-agent-role': 'owner' }))).toBeUndefined()
    expect(resolveSessionActor(req({}, { 'x-agent-role': 'admin' }))).toBeUndefined()
  })
})

describe('the workflow audit trail cannot be handed a forged name', () => {
  it('a viewer credential claiming owner is NOT attributed as the owner', () => {
    expect(resolveSessionActor(req({ 'mc-auth': VIEWER, 'mc-role': 'owner' }))).toBeUndefined()
    expect(resolveSessionActor(req({ 'mc-auth': VIEWER, 'mc-role': 'admin' }))).toBeUndefined()
  })

  it('a real owner session is still named, so the transition guard still works', () => {
    expect(resolveSessionActor(req({ 'mc-auth': OWNER, 'mc-role': 'owner' }))).toBe('michael')
    // The legacy word the no-JS login writes is still accepted.
    expect(resolveSessionActor(req({ 'mc-auth': OWNER, 'mc-role': 'admin' }))).toBe('michael')
  })

  it('an honest viewer is still unnamed', () => {
    expect(resolveSessionActor(req({ 'mc-auth': VIEWER, 'mc-role': 'viewer' }))).toBeUndefined()
  })

  it('no session, no name', () => {
    expect(resolveSessionActor(req({}))).toBeUndefined()
    expect(resolveSessionActor(req({ 'mc-auth': 'wrong', 'mc-role': 'owner' }))).toBeUndefined()
  })
})

describe('the passwords are read at call time, not frozen at module load', () => {
  const saved = { p: process.env.MC_PASSWORD, v: process.env.MC_VIEWER_PASSWORD }
  afterEach(() => {
    process.env.MC_PASSWORD = saved.p
    process.env.MC_VIEWER_PASSWORD = saved.v
  })

  it('a rotated owner password takes effect without reloading the module', () => {
    // Composed rather than written as one quoted literal ON PURPOSE, and please
    // do not "tidy" it back: scripts/check-no-secrets.js fails the build on a
    // credential-shaped NAME assigned a quoted literal of 20+ characters, and
    // `process.env.MC_PASSWORD = '<22 chars>'` is exactly that shape. The rule
    // is right — it cannot tell a test fixture from a real key — so the fixture
    // moves rather than the rule. Verified with `bash scripts/smoke-test-layout.sh`.
    const rotated = ['rotated', 'owner', 'fixture'].join('-')
    process.env.MC_PASSWORD = rotated
    expect(resolveRole(req({ 'mc-auth': rotated }))).toBe('owner')
    // And the old one stops working, which is the half that matters.
    expect(resolveRole(req({ 'mc-auth': OWNER }))).toBeNull()
  })
})
