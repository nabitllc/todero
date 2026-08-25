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

// Chainable stub for the two Supabase queries the route runs. Every builder
// method returns `this`, and awaiting the chain yields `{ data: [] }` — the
// route only needs run state, and empty run state is a legitimate answer.
function queryStub() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'order', 'limit', 'eq', 'single', 'upsert']) {
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
