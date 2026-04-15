// __tests__/middleware/permission-middleware.test.ts
// TOD-1498: Unit tests for permission middleware — allow and deny paths for all 5 roles.
//
// Coverage:
//   God        — allow any route (2 allow tests, no deny needed per AC)
//   Admin      — allow standard routes, deny god_manage routes
//   Viewer     — allow GET routes, deny write methods
//   Tron       — allow standard routes, deny human_required_* routes
//   DefaultBot — allow assigned scope (/api/issues, /api/sprints), deny outside scope

import {
  checkRoutePermission,
  getRequiredPermission,
  GOD_MANAGE_PATTERN,
  HUMAN_REQUIRED_PATTERN,
  DEFAULTBOT_SCOPE_PATTERN,
} from '@/lib/permission-check'

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
    expect(HUMAN_REQUIRED_PATTERN.test('/api/issues')).toBe(false)
  })

  it('DEFAULTBOT_SCOPE_PATTERN matches /api/issues and /api/sprints only', () => {
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/issues')).toBe(true)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/sprints')).toBe(true)
    expect(DEFAULTBOT_SCOPE_PATTERN.test('/api/settings')).toBe(false)
  })
})

describe('getRequiredPermission', () => {
  it('returns issues:admin for god_manage routes', () => {
    expect(getRequiredPermission('GET', '/api/god_manage/roles')).toBe('issues:admin')
    expect(getRequiredPermission('POST', '/api/god_manage/roles')).toBe('issues:admin')
  })

  it('returns settings:write for human_required routes', () => {
    expect(getRequiredPermission('GET', '/api/human_required_action')).toBe('settings:write')
  })

  it('returns issues:write for write methods on standard routes', () => {
    expect(getRequiredPermission('POST', '/api/issues')).toBe('issues:write')
    expect(getRequiredPermission('PATCH', '/api/issues')).toBe('issues:write')
    expect(getRequiredPermission('DELETE', '/api/issues')).toBe('issues:write')
  })

  it('returns issues:read for GET on standard routes', () => {
    expect(getRequiredPermission('GET', '/api/issues')).toBe('issues:read')
    expect(getRequiredPermission('GET', '/api/sprints')).toBe('issues:read')
  })
})

// ── God ───────────────────────────────────────────────────────────────────────

describe('God role', () => {
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
})

// ── Admin ─────────────────────────────────────────────────────────────────────

describe('Admin role', () => {
  it('ALLOW: can POST to a standard route (has issues:write)', async () => {
    dbAllow()
    const result = await checkRoutePermission('admin', 'POST', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot access god_manage routes (lacks issues:admin)', async () => {
    dbDeny()
    const result = await checkRoutePermission('admin', 'POST', '/api/god_manage/roles')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

// ── Viewer ────────────────────────────────────────────────────────────────────

describe('Viewer role', () => {
  it('ALLOW: can GET a standard route (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('viewer', 'GET', '/api/issues')
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
})

// ── Tron ──────────────────────────────────────────────────────────────────────

describe('Tron role', () => {
  it('ALLOW: can GET a standard route (has issues:read)', async () => {
    dbAllow()
    const result = await checkRoutePermission('tron', 'GET', '/api/issues')
    expect(result.allowed).toBe(true)
  })

  it('DENY: cannot access human_required_* routes (lacks settings:write)', async () => {
    dbDeny()
    const result = await checkRoutePermission('tron', 'GET', '/api/human_required_action')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

// ── DefaultBot ────────────────────────────────────────────────────────────────

describe('DefaultBot role', () => {
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

  it('DENY: cannot access /api/settings (outside assigned scope)', async () => {
    const result = await checkRoutePermission('defaultbot', 'GET', '/api/settings')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    // Scope denial is pre-DB — Supabase should not be called
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('DENY: cannot access /api/agents (outside assigned scope)', async () => {
    const result = await checkRoutePermission('defaultbot', 'POST', '/api/agents')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'OUT_OF_SCOPE' })
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── Response shape contract ───────────────────────────────────────────────────

describe('deny response shape', () => {
  it('all deny results have status 403 and machine-readable body', async () => {
    const denyCases: Array<[Parameters<typeof checkRoutePermission>, boolean]> = [
      [['admin', 'POST', '/api/god_manage/roles'], true],  // DB deny
      [['viewer', 'POST', '/api/issues'], true],            // DB deny
      [['tron', 'GET', '/api/human_required_action'], true], // DB deny
      [['defaultbot', 'GET', '/api/settings'], false],      // scope deny (no DB)
    ]

    for (const [[role, method, path], needsDbDeny] of denyCases) {
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
  })
})
