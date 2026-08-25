/**
 * Portability: GET /api/agents on a host that has no Supabase key.
 *
 * This is the "any machine" case the whole cross-platform effort exists for.
 * The route used to catch the resulting `supabaseKey is required` throw and
 * answer HTTP 200 with `[]`, which made an unconfigured machine look exactly
 * like a machine with no agents. It must now answer 503 with a reason, while
 * still shipping the roster it genuinely does know about.
 *
 * The route reads the key at module scope, so the env var is cleared BEFORE
 * the module is required (next/jest loads .env.local into process.env).
 */

// Process listing is a real OS spawn; stub it so the test measures the
// configuration contract, not powershell/ps latency.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process')
  return {
    ...actual,
    execFile: (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
    ) => cb(null, { stdout: '', stderr: '' }),
  }
})

type AgentsBody = {
  agents: Array<{ id: string; rosterSource: string }>
  rosterSource: string
  rosterWarning: string | null
  configured: boolean
  error: string | null
}

async function getWithoutKey(): Promise<{ status: number; body: AgentsBody }> {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  jest.resetModules()
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const route = require('@/app/api/agents/route')
    const res = await route.GET()
    return { status: res.status, body: (await res.json()) as AgentsBody }
  } finally {
    if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved
    jest.resetModules()
  }
}

describe('GET /api/agents with SUPABASE_SERVICE_ROLE_KEY unset', () => {
  it('answers 503 — never an empty 200', async () => {
    const { status } = await getWithoutKey()
    expect(status).toBe(503)
  })

  it('carries a non-null error naming the missing key', async () => {
    const { body } = await getWithoutKey()
    expect(body.error).not.toBeNull()
    expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(body.configured).toBe(false)
  })

  it('still returns the roster so the operator sees who exists', async () => {
    const { body } = await getWithoutKey()
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.agents.length).toBeGreaterThan(0)
    // 'builtin' is gone: the roster is AGENTS.md or it is empty. This host has
    // one, so an unconfigured database must not cost the operator the roster.
    expect(body.rosterSource).toBe('agents-md')
  })
})

describe('POST/PATCH /api/agents with SUPABASE_SERVICE_ROLE_KEY unset', () => {
  it('refuse writes with 503 rather than throwing', async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    jest.resetModules()
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const route = require('@/app/api/agents/route')
      const req = { json: async () => ({ agent_id: 'builder' }) } as Request
      expect((await route.POST(req)).status).toBe(503)
      expect((await route.PATCH(req)).status).toBe(503)
    } finally {
      if (saved !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved
      jest.resetModules()
    }
  })
})
