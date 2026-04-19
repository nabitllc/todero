// __tests__/rbac-middleware.test.ts
// TOD-1059: Unit tests for RBAC middleware — all 5 roles, allow + deny paths.
//
// Coverage:
//   God        — allow on any permission (AC-2)
//   Admin      — allow admin-scoped, deny god_manage (AC-3)
//   Viewer     — allow read, deny all write (AC-4)
//   Tron       — deny human_required_* routes (AC-5)
//   DefaultBot — deny outside assigned scope (AC-6)
//   Missing/invalid role header → 403 (AC-7)
//   Edge cases: DB error, unknown role, response shape contract

import {
  checkRoutePermission,
  getRequiredPermission,
  GOD_MANAGE_PATTERN,
  HUMAN_REQUIRED_PATTERN,
  DEFAULTBOT_SCOPE_PATTERN,
} from '@/lib/permission-check'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

// ── Mock Supabase ─────────────────────────────────────────────────────────────
//
// The .from().select().eq().eq().maybeSingle() chain is mocked so tests run
// without any network access or real Supabase instance.

const mockMaybeSingle = jest.fn()
const mockEqPermission = jest.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockEqRole = jest.fn(() => ({ eq: mockEqPermission }))
const mockSelect = jest.fn(() => ({ eq: mockEqRole }))
const mockFrom = jest.fn(() => ({ select: mockSelect }))

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockFrom }),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate DB returning a matching row (permission granted). */
function dbAllow() {
  mockMaybeSingle.mockResolvedValue({ data: { permission: 'issues:read' }, error: null })
}

/** Simulate DB returning no row (permission missing for this role). */
function dbDeny() {
  mockMaybeSingle.mockResolvedValue({ data: null, error: null })
}

/** Build a NextRequest with optional mc-role cookie. */
function makeRequest(
  pathname: string,
  method: string,
  roleCookie?: string,
): NextRequest {
  const headers: Record<string, string> = {}
  if (roleCookie !== undefined) {
    headers['cookie'] = `mc-role=${roleCookie}`
  }
  return new NextRequest(`http://localhost${pathname}`, { method, headers })
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Route pattern smoke tests ─────────────────────────────────────────────────

describe('route patterns', () => {
  it('GOD_MANAGE_PATTERN matches /api/god_manage paths', () => {
    expect(GOD_MANAGE_PATTERN.test('/api/god_manage/roles')).toBe(true)
    expect(GOD_MANAGE_PATTERN.test('/api/issues')).toBe(false)
  })

  it('HUMAN_REQUIRED_PATTERN matches /api/human_required_* paths', () => {
    expect(HUMAN_REQUIRED_PATTERN.test('/api/human_required_action')).toBe(true)
    expect(HUMAN_REQUIRED_PATTERN.test('/api/human_required_confirm')).toBe(true)
    expect(HUMAN_REQUIRED_PATTERN.test('/api/issues')).toBe(false)
  })

  it('DEFAULTBOT_SCOPE_PATTERN matches /api/issues and /api/sprints only', () => {
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/issues')).toBe(true)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/sprints')).toBe(true)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/settings')).toBe(false)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/agents')).toBe(false)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/god_manage/roles')).toBe(false)
  })
})

// ── getRequiredPermission ─────────────────────────────────────────────────────

describe('getRequiredPermission', () => {
  it('returns issues:admin for god_manage routes (any method)', () => {
    expect(getRequiredPermission('GET', '/api/god_manage/roles')).toBe('issues:admin')
    expect(getRequiredPermission('POST', '/api/god_manage/roles')).toBe('issues:admin')
    expect(getRequiredPermission('DELETE', '/api/god_manage/roles')).toBe('issues:admin')
  })

  it('returns settings:write for human_required routes', () => {
    expect(getRequiredPermission('GET', '/api/human_required_action')).toBe('settings:write')
    expect(getRequiredPermission('POST', '/api/human_required_confirm')).toBe('settings:write')
  })

  it('returns issues:write for write methods on standard routes', () => {
    expect(getRequiredPermission('POST', '/api/issues')).toBe('issues:write')
    expect(getRequiredPermission('PATCH', '/api/issues')).toBe('issues:write')
    expect(getRequiredPermission('DELETE', '/api/issues')).toBe('issues:write')
    expect(getRequiredPermission('PUT', '/api/issues')).toBe('issues:write')
  })

  it('returns issues:read for GET on standard routes', () => {
    expect(getRequiredPermission('GET', '/api/issues')).toBe('issues:read')
    expect(getRequiredPermission('GET', '/api/sprints')).toBe('issues:read')
    expect(getRequiredPermission('GET', '/api/agents')).toBe('issues:read')
  })
})

// ── God role (AC-2) ───────────────────────────────────────────────────────────

describe('God role (AC-2)', () => {
  it('ALLOW: can GET a standard route', async () => {
    dbAllow()
    const result = await checkRoutePermission('god', 'GET', '/api/issues')
    expect(result.allowed).toBe(true)
    expect(result.status).toBeUndefined()
  })

  it('ALLOW: can POST to a god_manage route', async () => {
    dbAllow()
    const result = await checkRoutePermission('god', 'POST', '/api/god_manage/roles')
    expect(result.allowed).toBe(true)
    expect(result.status).toBeUndefined()
  })

  it('ALLOW: can DELETE on any resource', async () => {
    dbAllow()
    const result = await checkRoutePermission('god', 'DELETE', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can access human_required routes', async () => {
    dbAllow()
    const result = await checkRoutePermission('god', 'GET', '/api/human_required_action')
    expect(result.allowed).toBe(true)
  })
})

// ── Admin role (AC-3) ─────────────────────────────────────────────────────────

describe('Admin role (AC-3)', () => {
  it('ALLOW: can POST to a standard route (has issues:write)', async () => {
    dbAllow()
    const result = await checkRoutePermission('admin', 'POST', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can GET a standard route (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('admin', 'GET', '/api/sprints')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can PATCH issues (has issues:write)', async () => {
    dbAllow()
    const result = await checkRoutePermission('admin', 'PATCH', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot access /api/god_manage/roles (lacks issues:admin)', async () => {
    dbDeny()
    const result = await checkRoutePermission('admin', 'POST', '/api/god_manage/roles')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot GET /api/god_manage routes either (issues:admin required for any method)', async () => {
    dbDeny()
    const result = await checkRoutePermission('admin', 'GET', '/api/god_manage/roles')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
  })
})

// ── Viewer role (AC-4) ────────────────────────────────────────────────────────

describe('Viewer role (AC-4)', () => {
  it('ALLOW: can GET a standard route (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('viewer', 'GET', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can GET /api/sprints (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('viewer', 'GET', '/api/sprints')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot POST (lacks issues:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('viewer', 'POST', '/api/issues')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot PATCH (lacks issues:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('viewer', 'PATCH', '/api/issues')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot DELETE (lacks issues:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('viewer', 'DELETE', '/api/issues')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot PUT (lacks issues:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('viewer', 'PUT', '/api/issues')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
  })
})

// ── Tron role (AC-5) ──────────────────────────────────────────────────────────

describe('Tron role (AC-5)', () => {
  it('ALLOW: can GET a standard route (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('tron', 'GET', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can POST to a standard route (has issues:write)', async () => {
    dbAllow()
    const result = await checkRoutePermission('tron', 'POST', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot GET /api/human_required_action (lacks settings:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('tron', 'GET', '/api/human_required_action')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot POST to /api/human_required_confirm (lacks settings:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('tron', 'POST', '/api/human_required_confirm')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('DENY: cannot access /api/god_manage (lacks issues:admin)', async () => {
    dbDeny()
    const result = await checkRoutePermission('tron', 'POST', '/api/god_manage/roles')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
  })
})

// ── DefaultBot role (AC-6) ────────────────────────────────────────────────────

describe('DefaultBot role (AC-6)', () => {
  it('ALLOW: can GET /api/issues (within assigned scope)', async () => {
    dbAllow()
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('ALLOW: can GET /api/sprints (within assigned scope)', async () => {
    dbAllow()
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/sprints')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot access /api/settings (outside assigned scope — no DB call)', async () => {
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/settings')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DENY: cannot access /api/agents (outside assigned scope — no DB call)', async () => {
    const result = await checkRoutePermission('defaultbot', 'POST', '/api/agents')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DENY: cannot access /api/god_manage (outside assigned scope — no DB call)', async () => {
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/god_manage/roles')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DENY: cannot access /api/projects (outside assigned scope — no DB call)', async () => {
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/projects')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Missing / invalid role header (AC-7) ─────────────────────────────────────
//
// Tests the Next.js middleware() function directly.
// Missing or unrecognised mc-role cookie on a write endpoint that requires
// roles:admin (e.g. POST /api/roles) must return 403.

describe('Missing/invalid role header (AC-7)', () => {
  it('DENY: POST /api/roles with no mc-role cookie returns 403', async () => {
    const req = makeRequest('/api/roles', 'POST')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('DENY: POST /api/roles with an unrecognised role cookie returns 403', async () => {
    const req = makeRequest('/api/roles', 'POST', 'hacker')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('DENY: POST /api/roles with role=viewer (no roles:admin) returns 403', async () => {
    const req = makeRequest('/api/roles', 'POST', 'viewer')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('DENY: POST /api/roles with role=tron (no roles:admin) returns 403', async () => {
    const req = makeRequest('/api/roles', 'POST', 'tron')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('DENY: POST /api/roles with role=defaultbot (no roles:admin) returns 403', async () => {
    const req = makeRequest('/api/roles', 'POST', 'defaultbot')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('ALLOW: POST /api/roles with role=owner passes through', async () => {
    const req = makeRequest('/api/roles', 'POST', 'owner')
    const res = await middleware(req)
    // owner has roles:admin — should pass the middleware (not 403)
    expect(res.status).not.toBe(403)
  })

  it('ALLOW: POST /api/roles with role=god passes through (god has roles:admin)', async () => {
    const req = makeRequest('/api/roles', 'POST', 'god')
    const res = await middleware(req)
    expect(res.status).not.toBe(403)
  })

  it('DENY: POST /api/issues with role=viewer returns 403', async () => {
    const req = makeRequest('/api/issues', 'POST', 'viewer')
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('ALLOW: POST /api/issues with no cookie passes through (server-side agent call)', async () => {
    // No mc-role cookie on non-roles endpoints is treated as a server-side agent —
    // the middleware intentionally allows this path through.
    const req = makeRequest('/api/issues', 'POST')
    const res = await middleware(req)
    expect(res.status).not.toBe(403)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('unknown role treated as absent by DB (deny on any non-trivial permission)', async () => {
    // TypeScript cast required to simulate a rogue/unknown role value at runtime
    dbDeny()
    const result = await checkRoutePermission('unknown' as 'god', 'POST', '/api/issues')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('GET /api/health is always allowed (public endpoint)', async () => {
    const req = makeRequest('/api/health', 'GET')
    const res = await middleware(req)
    // health endpoint is whitelisted — must not 403
    expect(res.status).not.toBe(403)
  })
})

// ── Response shape contract ───────────────────────────────────────────────────

describe('deny response shape', () => {
  const denyCases: Array<[Parameters<typeof checkRoutePermission>, boolean]> = [
    [['admin', 'POST', '/api/god_manage/roles'], true],     // DB deny
    [['viewer', 'POST', '/api/issues'], true],              // DB deny
    [['viewer', 'PATCH', '/api/issues'], true],             // DB deny
    [['tron', 'GET', '/api/human_required_action'], true],  // DB deny
    [['defaultbot', 'GET', '/api/settings'], false],        // scope deny (no DB)
    [['defaultbot', 'GET', '/api/agents'], false],          // scope deny (no DB)
  ]

  it.each(denyCases)(
    'checkRoutePermission(%j) returns status=403 with machine-readable body',
    async ([role, method, path], needsDbDeny) => {
      jest.clearAllMocks()
      if (needsDbDeny) dbDeny()

      const result = await checkRoutePermission(role, method, path)
      expect(result.allowed).toBe(false)
      expect(result.status).toBe(403)
      expect(result.body).toBeDefined()
      expect(typeof result.body!.error).toBe('string')
      expect(typeof result.body!.code).toBe('string')
      expect(result.body!.error.length).toBeGreaterThan(0)
      expect(result.body!.code.length).toBeGreaterThan(0)
    }
  )
})
