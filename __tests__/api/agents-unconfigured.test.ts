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
 *
 * The provider is pinned to `supabase` throughout, because "no Supabase key"
 * is only an unconfigured host for a host that uses Supabase. A checkout with
 * no credentials at all resolves to the file-backed `sqlite` provider instead
 * (lib/db/adapters.ts) and is genuinely configured — that is a different
 * contract, covered by lib/__tests__/db-seam.test.ts.
 */
import path from 'path'
import os from 'os'

/**
 * ─── WHY THE THIRD CASE BELOW WAS RED FOR THE WHOLE PROGRAM ─────────────────
 *
 * `rosterSource` is not a fact about the database, so an unconfigured host
 * was never the reason this failed. It failed because GET /api/agents grew a
 * THIRD source of "who exists" — the Brain2 vault registry (lib/vault-agents.ts,
 * docs/brain2-integration.md) — and `loadVaultAgentRoster()` runs BEFORE the
 * `isDbConfigured()` branch, so the 503 envelope carries vault rows too and
 * `rosterSource` reads 'both', not 'agents-md'.
 *
 * That made this file host-dependent: green on a machine with no vault, red on
 * one with a vault at TODERO_VAULT_DIR (default C:\Development\Mich-Brain2).
 * Measured 2026-08-26 on this host: 13 vault agents join the union.
 *
 * This file is about the DATABASE contract, so the vault leg is pinned off
 * here rather than asserted around. lib/paths.ts reads TODERO_VAULT_DIR into a
 * module-scope const, so it is set inside this helper, which already
 * `jest.resetModules()`s around the require. The union itself is covered by
 * __tests__/api/agents-roster-union.test.ts.
 */
const NO_VAULT_DIR = path.join(os.tmpdir(), 'todero-no-such-vault')

/** Clear the key while forcing the Supabase provider; restore both after. */
function withoutSupabaseKey<T>(run: () => T): T {
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const savedProvider = process.env.TODERO_DB_PROVIDER
  const savedVault = process.env.TODERO_VAULT_DIR
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.TODERO_DB_PROVIDER = 'supabase'
  process.env.TODERO_VAULT_DIR = NO_VAULT_DIR
  jest.resetModules()
  try {
    return run()
  } finally {
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey
    if (savedProvider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = savedProvider
    if (savedVault === undefined) delete process.env.TODERO_VAULT_DIR
    else process.env.TODERO_VAULT_DIR = savedVault
    jest.resetModules()
  }
}

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
  return withoutSupabaseKey(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const route = require('@/app/api/agents/route')
    const res = await route.GET()
    return { status: res.status, body: (await res.json()) as AgentsBody }
  })
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
    // With the vault leg pinned off (see NO_VAULT_DIR above) AGENTS.md is the
    // only remaining source, so 'agents-md' is the exact expected value rather
    // than one of several a host might produce.
    expect(body.rosterSource).toBe('agents-md')
    // And every row says so too — the envelope-level value is not allowed to
    // disagree with the rows it summarises.
    for (const a of body.agents) expect(a.rosterSource).toBe('agents-md')
  })
})

describe('POST/PATCH /api/agents with SUPABASE_SERVICE_ROLE_KEY unset', () => {
  it('refuse writes with 503 rather than throwing', async () => {
    await withoutSupabaseKey(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const route = require('@/app/api/agents/route')
      const req = { json: async () => ({ agent_id: 'builder' }) } as Request
      expect((await route.POST(req)).status).toBe(503)
      expect((await route.PATCH(req)).status).toBe(503)
    })
  })
})
