/**
 * GET /api/agents — the THREE-SOURCE union contract.
 *
 * This file exists because of what made the other two agent-route suites red
 * for the entire rebuild program. GET /api/agents answers "who exists" from
 * three independent sources:
 *
 *   1. the host's AGENTS.md            (lib/agent-roster.ts)
 *   2. `agent_registrations`           (lib/agent-registrations.ts, POST /api/connect)
 *   3. the Brain2 vault registry       (lib/vault-agents.ts, Global_Agents/<id>/manifest.json)
 *
 * `__tests__/agents-route.test.ts` and `__tests__/api/agents-unconfigured.test.ts`
 * were both written before source 3 existed and still asserted "the roster is
 * AGENTS.md or it is empty". Rather than being obviously wrong, they were
 * HOST-DEPENDENT — green on a machine with no vault, red on a machine with
 * one — which is exactly the shape of failure that gets read as scenery. Both
 * now pin `TODERO_VAULT_DIR` at a directory that does not exist, so they test
 * their own leg deterministically.
 *
 * That left the union with no coverage at all, which is what this file adds.
 * It builds a REAL fixture vault on disk (never the operator's actual vault,
 * which is read-only to Todero and whose contents change under us), so every
 * assertion below holds on any host, CI included.
 *
 * The property that matters most is the one the route's `respond()` comment
 * claims and nothing checked: an id named by more than one source renders
 * ONCE. A double-counted agent is precisely how the Fleet roster and the
 * Roles surface came to disagree about how many agents exist.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

// One fixture vault, created before the route module graph is required —
// lib/paths.ts reads TODERO_VAULT_DIR into a module-scope const, so setting it
// later has no effect.
const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'todero-vault-fixture-'))
const GLOBAL_AGENTS = path.join(VAULT_ROOT, 'Global_Agents')

/** `builder` is deliberately also in the repo's AGENTS.md — the collision case. */
const COLLIDING_ID = 'builder'
const VAULT_ONLY_IDS = ['fixture_alpha', 'fixture_beta']

function writeManifest(id: string) {
  const dir = path.join(GLOBAL_AGENTS, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name: `Fixture ${id}`,
      description: `fixture manifest for ${id}`,
      model: { tier: 'mid', claude_code_alias: 'sonnet', preferred: 'claude-sonnet-4-6', fallback_local: 'qwen2.5-coder:14b' },
      tools: ['filesystem_read'],
      compatible_with: ['claude-code'],
      local_eligible: false,
    }),
    'utf-8',
  )
}
for (const id of [COLLIDING_ID, ...VAULT_ONLY_IDS]) writeManifest(id)

process.env.TODERO_VAULT_DIR = VAULT_ROOT
// AGENTS.md stays the repo's own, so the agents-md leg is real rather than
// fixtured — this test is about how the legs COMBINE, not about parsing.
delete process.env.AGENTS_MD_PATH

// Chainable Supabase stub: the route only needs run state, and empty run state
// is a legitimate answer. `agent_registrations` therefore contributes nothing,
// so the union under test here is agents-md ∪ vault.
function queryStub() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'order', 'limit', 'eq', 'single', 'maybeSingle', 'upsert']) {
    chain[m] = () => chain
  }
  chain.then = (resolve: (v: { data: never[] }) => unknown) => resolve({ data: [] })
  return chain
}

jest.mock('@/lib/db', () => ({
  db: () => ({ from: () => queryStub() }),
  isDbConfigured: () => true,
  dbStatusMessage: () => 'stubbed',
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires -- must load after jest.mock and after TODERO_VAULT_DIR is set
const { GET } = require('@/app/api/agents/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadAgentRoster } = require('@/lib/agent-roster')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadFleetRoster } = require('@/app/api/agents/fleet-roster')

afterAll(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true })
})

type Row = { id: string; rosterSource: string; vault: unknown | null }

async function body(): Promise<{
  agents: Row[]
  rosterSource: string
  vaultPath: string | null
  vaultWarning: string | null
}> {
  return (await (await GET()).json())
}

describe('GET /api/agents — union of AGENTS.md and the Brain2 vault', () => {
  it('scans the fixture vault and says which directory it read', async () => {
    const b = await body()
    expect(b.vaultPath).toBe(GLOBAL_AGENTS)
    // A vault it could read and that parsed cleanly has nothing to warn about.
    expect(b.vaultWarning).toBeNull()
  })

  it('reports rosterSource "both" when two sources each contributed a row', async () => {
    const b = await body()
    expect(b.rosterSource).toBe('both')
  })

  it('adds every vault-only agent as its own row, sourced to the vault', async () => {
    const b = await body()
    for (const id of VAULT_ONLY_IDS) {
      const rows = b.agents.filter(a => a.id === id)
      expect(rows).toHaveLength(1)
      expect(rows[0].rosterSource).toBe('vault')
      expect(rows[0].vault).not.toBeNull()
    }
  })

  it('renders an id named by BOTH sources exactly once, as its AGENTS.md row', async () => {
    const b = await body()
    const rows = b.agents.filter(a => a.id === COLLIDING_ID)
    // The double-count this asserts against is the mechanism behind the
    // Fleet-vs-Roles count disagreement this piece was opened for.
    expect(rows).toHaveLength(1)
    expect(rows[0].rosterSource).toBe('agents-md')
    // Enriched, not replaced: the roster row still carries the manifest, so
    // nothing is lost by rendering it once.
    expect(rows[0].vault).not.toBeNull()
  })

  it('emits no duplicate ids at all', async () => {
    const b = await body()
    const ids = b.agents.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('is exactly AGENTS.md ∪ vault — no invented rows, none dropped', async () => {
    const b = await body()
    const mdIds: string[] = loadAgentRoster().agents.map((a: { id: string }) => a.id)
    const expected = new Set<string>([...mdIds, COLLIDING_ID, ...VAULT_ONLY_IDS])
    expect(new Set(b.agents.map(a => a.id))).toEqual(expected)
    expect(b.agents).toHaveLength(mdIds.length + VAULT_ONLY_IDS.length)
  })
})

/**
 * The drift guard.
 *
 * GET /api/agents and GET /api/agent-responsibilities are two surfaces that
 * must name the same fleet, and for the whole rebuild they did not: Roster
 * said 28 and Roles said 14 (measured 2026-08-26). The fix is that both now
 * derive from app/api/agents/fleet-roster.ts. This asserts the derivation is
 * REAL for the route — that its rows are exactly the shared loader's ids, in
 * the same order — so a future edit that quietly re-opens the union inline in
 * the route fails here instead of on someone's screen a month later.
 *
 * It deliberately compares against `loadFleetRoster()` rather than against a
 * hardcoded list: a hardcoded list would have to be updated whenever AGENTS.md
 * changes, and a test nobody can keep green is how the two suites this file
 * was written alongside became scenery in the first place.
 */
describe('GET /api/agents does not re-derive the union it shares with Roles', () => {
  it('emits exactly the ids loadFleetRoster() returns, in the same order', async () => {
    const b = await body()
    const shared = await loadFleetRoster()
    expect(b.agents.map(a => a.id)).toEqual(shared.ids)
  })

  it('agrees with loadFleetRoster() about which source claimed each id', async () => {
    const b = await body()
    const shared = await loadFleetRoster()
    for (const row of b.agents) {
      expect(row.rosterSource).toBe(shared.sourceById[row.id])
    }
  })

  it('agrees with loadFleetRoster() about the envelope-level rosterSource', async () => {
    const b = await body()
    const shared = await loadFleetRoster()
    expect(b.rosterSource).toBe(shared.rosterSource)
  })
})
