/**
 * GET /api/agents — the roster contract.
 *
 * These exercise the real exported route handler, with the database seam
 * mocked, because the two behaviours that matter are decisions the route makes
 * on its own: a roster file that is not there must produce a 200 with an empty
 * roster and a warning naming the path, and the roster that IS there must be
 * reproduced row for row with nothing invented alongside it.
 */
import path from 'path'
import os from 'os'

// ─── WHY THIS FILE WAS RED FOR THE WHOLE PROGRAM ────────────────────────────
//
// Every gate report in this repo says "5 known failures" and moves on. Three
// of them were here, and the cause is not a bug in the route: it is that this
// file asserts a TWO-SOURCE contract ("the roster is AGENTS.md or it is
// empty") that stopped being true when GET /api/agents grew a THIRD source —
// the Brain2 vault registry at `<TODERO_VAULT_DIR>/Global_Agents/<id>/
// manifest.json` (lib/vault-agents.ts, docs/brain2-integration.md).
//
// That made the file HOST-DEPENDENT, which is why it looked like scenery:
//   * on a machine with no vault it passes, because the third source is empty;
//   * on a machine with one (the author's, TODERO_VAULT_DIR defaults to
//     C:\Development\Mich-Brain2) it fails, because 13 vault agents join the
//     union and `rosterSource` becomes 'both'.
// Measured 2026-08-26 against the running server: 28 agents — 14 agents-md,
// 1 registered, 13 vault.
//
// The fix is NOT to relax the assertions. It is to make the environment
// explicit: this file tests the AGENTS.md leg of the union, so it pins the
// vault to a directory that does not exist and the assertions become
// deterministic on every host. `TODERO_VAULT_DIR` is read into a module-scope
// const in lib/paths.ts, so it must be set BEFORE the route module graph is
// required — hence its position here, above the require below.
//
// The union itself — three sources, no double-counting — is covered by
// __tests__/api/agents-roster-union.test.ts, which builds a fixture vault.
process.env.TODERO_VAULT_DIR = path.join(os.tmpdir(), 'todero-no-such-vault')

// Chainable stub for the two Supabase queries the route runs. Every builder
// method returns `this`, and awaiting the chain yields `{ data: [] }` — the
// route only needs run state, and empty run state is a legitimate answer.
//
// A METHOD MISSING FROM THIS LIST IS NOT A NO-OP — IT IS A 503. The route's
// query chain runs inside a try/catch that answers 503 with the error text, so
// an unstubbed builder method throws `chain.X is not a function` and the whole
// request degrades to "database unavailable" — with the assertion failing as
// `Expected: 200, Received: 503`, which reads like a route regression rather
// than a missing stub. That is exactly what happened when `.is('archived_at',
// null)` was added to the issues query in round 3 of the fleet-provenance
// piece. Keep this list in step with app/api/agents/route.ts.
function queryStub() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'is', 'order', 'limit', 'eq', 'single', 'maybeSingle', 'upsert']) {
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

// eslint-disable-next-line @typescript-eslint/no-var-requires -- must load after jest.mock
const { GET } = require('@/app/api/agents/route')

const prevOverride = process.env.AGENTS_MD_PATH

afterEach(() => {
  if (prevOverride === undefined) delete process.env.AGENTS_MD_PATH
  else process.env.AGENTS_MD_PATH = prevOverride
})

describe('GET /api/agents', () => {
  it('answers 200 with the roster the repo AGENTS.md declares, including ops and deployer', async () => {
    delete process.env.AGENTS_MD_PATH

    const res = await GET()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.rosterSource).toBe('agents-md')
    expect(body.rosterWarning).toBeNull()
    expect(path.basename(body.rosterPath)).toBe('AGENTS.md')

    const ids = body.agents.map((a: { id: string }) => a.id)
    expect(ids.length).toBeGreaterThan(4)
    expect(ids).toContain('ops')
    expect(ids).toContain('deployer')
  })

  it('answers 200 with an EMPTY roster and a warning naming the path when AGENTS_MD_PATH is missing', async () => {
    const bogus = path.join(os.tmpdir(), 'todero-no-such-roster.md')
    process.env.AGENTS_MD_PATH = bogus

    const res = await GET()
    // Not a 500, and not a silent fallback to the repo's own AGENTS.md.
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.agents).toEqual([])
    expect(body.rosterSource).toBe('none')
    expect(body.rosterPath).toBeNull()
    expect(body.rosterWarning).toContain(bogus)
  })

  it('never reports an agent the roster does not declare', async () => {
    delete process.env.AGENTS_MD_PATH

    // eslint-disable-next-line @typescript-eslint/no-var-requires -- parallel import of the roster source
    const { loadAgentRoster } = require('@/lib/agent-roster')
    const declared = new Set(loadAgentRoster().agents.map((a: { id: string }) => a.id))

    const body = await (await GET()).json()
    for (const agent of body.agents) {
      expect(declared.has(agent.id)).toBe(true)
    }
    expect(body.agents).toHaveLength(declared.size)
  })
})
