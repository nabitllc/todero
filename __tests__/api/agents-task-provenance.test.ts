/**
 * GET /api/agents — `currentTaskSource` / `currentTaskLabel`, at the route.
 *
 * ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `currentTaskSource` is the one field the fleet-liveness piece was written to
 * add. It is computed in three places in app/api/agents/route.ts (the AGENTS.md
 * builder, the registration builder, the vault-only builder) and, until this
 * file, was asserted in NONE of them. A fresh-context critic proved the hole
 * the only way that counts: it flipped the AGENTS.md builder from
 *
 *     currentTaskSource: issue ? 'assigned-issue' : beat?.task ? 'heartbeat' : 'none'
 *
 * to `issue ? 'heartbeat'` — the exact lie the field was introduced to end,
 * wording a BOARD row as the AGENT's own report — and ran every agents suite in
 * the repo. All 16 tests passed. The unit tests in lib/__tests__/fleet-activity
 * .test.ts and components/tabs/__tests__/crew-tab-activity.test.ts cover what
 * the UI does with the value; nothing covered whether the server puts the right
 * value on the wire.
 *
 * So the contract under test here is the SERVER's, and it is three claims, each
 * of which that mutant breaks:
 *
 *   1. An assignee-sourced task emits 'assigned-issue'.       <- kills the mutant
 *   2. A heartbeat-sourced task emits 'heartbeat'.
 *   3. When BOTH exist the issue wins the string, so the source must say so.
 *
 * Plus the claim §2.4 of the piece doc makes and nothing checked: the
 * registration and vault-only builders are heartbeat-only BY CONSTRUCTION —
 * they never read the issues table — so an issues row naming one of them must
 * not produce 'assigned-issue' on that row.
 *
 * `currentTaskLabel` (round 2) is the same value pre-worded for the five
 * surfaces that render one short truncated string; it is asserted here too,
 * because a label that disagrees with its own source field is the same defect
 * one indirection along.
 *
 * ─── HOW IT DRIVES THE ROUTE ─────────────────────────────────────────────────
 *
 * The database seam is stubbed PER TABLE rather than mocking lib/agent-
 * heartbeats.ts or lib/agent-registrations.ts, so the real row-to-object
 * mappers in those modules run. A test that mocked the readers would keep
 * passing over a route that had stopped reading them.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

// ─── Fixtures. Must exist before the route module graph is required:
// lib/paths.ts reads TODERO_VAULT_DIR into a module-scope const. ──────────────

const VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'todero-task-prov-vault-'))
const VAULT_ONLY_ID = 'fixture_vault_only'
{
  const dir = path.join(VAULT_ROOT, 'Global_Agents', VAULT_ONLY_ID)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name: 'Fixture Vault Only',
      description: 'vault-only fixture for task provenance',
      model: {
        tier: 'mid',
        claude_code_alias: 'sonnet',
        preferred: 'claude-sonnet-4-6',
        fallback_local: 'qwen2.5-coder:14b',
      },
      tools: [],
      compatible_with: ['claude-code'],
      local_eligible: false,
    }),
    'utf-8',
  )
}
process.env.TODERO_VAULT_DIR = VAULT_ROOT
delete process.env.AGENTS_MD_PATH

/** Ids the repo's own AGENTS.md declares. Asserted below, not assumed. */
const ASSIGNED_ONLY = 'builder' // an issues row names it, no heartbeat
const HEARTBEAT_ONLY = 'tester' // a heartbeat carries a task, no issues row
const BOTH = 'deployer' // both — the issue must win, and say so
const NEITHER = 'ops' // neither
const REGISTRATION_ONLY = 'fixture_registration_only'

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const HEARTBEAT_TASK = 'TOD-7777: what the agent itself says it is on'
const BOTH_HEARTBEAT_TASK = 'TOD-8888: the agent own claim, outranked by the board'

const mockIssues = [
  {
    task_key: 'TOD-9001', title: 'assignee-sourced fixture', status: 'in_progress',
    assignee: ASSIGNED_ONLY, worked_by: null, updated_at: iso(60_000), started_at: iso(60_000),
  },
  {
    task_key: 'TOD-9002', title: 'both-sources fixture', status: 'in_progress',
    assignee: BOTH, worked_by: null, updated_at: iso(60_000), started_at: iso(60_000),
  },
  // The next two name builders that DO NOT READ THIS TABLE. If either shows up
  // as 'assigned-issue', a builder grew an issues lookup it is not supposed to
  // have, and that row would be claiming board evidence it never consulted.
  {
    task_key: 'TOD-9003', title: 'names a registration-only agent', status: 'in_progress',
    assignee: REGISTRATION_ONLY, worked_by: null, updated_at: iso(60_000), started_at: null,
  },
  {
    task_key: 'TOD-9004', title: 'names a vault-only agent', status: 'in_progress',
    assignee: VAULT_ONLY_ID, worked_by: null, updated_at: iso(60_000), started_at: null,
  },
]

const mockBeats = [
  { agent_id: HEARTBEAT_ONLY, last_seen: iso(5_000), pid: 1, host: 'h', task: HEARTBEAT_TASK },
  { agent_id: BOTH, last_seen: iso(5_000), pid: 2, host: 'h', task: BOTH_HEARTBEAT_TASK },
  { agent_id: REGISTRATION_ONLY, last_seen: iso(5_000), pid: 3, host: 'h', task: 'TOD-6666: registration heartbeat' },
  { agent_id: VAULT_ONLY_ID, last_seen: iso(5_000), pid: 4, host: 'h', task: 'TOD-5555: vault heartbeat' },
]

const mockRegistrations = [
  {
    id: REGISTRATION_ONLY, name: 'Fixture Registration', runtime: 'claude-code', status: 'active',
    capabilities: [], connection_id: 'conn-1',
    registered_at: iso(600_000), last_seen_at: iso(5_000),
  },
]

const mockTables: Record<string, unknown[]> = {
  issues: mockIssues,
  agent_heartbeats: mockBeats,
  agent_registrations: mockRegistrations,
}

jest.mock('@/lib/db', () => ({
  db: () => ({
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase stub
      const chain: any = {}
      for (const m of ['select', 'in', 'order', 'limit', 'eq', 'single', 'maybeSingle', 'upsert']) {
        chain[m] = () => chain
      }
      const rows = mockTables[table] ?? []
      chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: rows, error: null })
      return chain
    },
  }),
  isDbConfigured: () => true,
  dbStatusMessage: () => 'stubbed',
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires -- must load after jest.mock
const { GET } = require('@/app/api/agents/route')

type Row = {
  id: string
  currentTask: string | null
  currentTaskSource: 'heartbeat' | 'assigned-issue' | 'none'
  currentTaskLabel: string | null
  workStartedAt: number | null
  rosterSource: string
}

let rows: Row[]
const byId = (id: string): Row => {
  const r = rows.find(x => x.id === id)
  if (!r) throw new Error(`fixture agent "${id}" is not on the roster — rows: ${rows.map(x => x.id).join(', ')}`)
  return r
}

beforeAll(async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  rows = (await res.json()).agents
})

describe('the fixtures themselves', () => {
  it('names four AGENTS.md agents that really are on this roster', () => {
    for (const id of [ASSIGNED_ONLY, HEARTBEAT_ONLY, BOTH, NEITHER]) {
      expect(byId(id).rosterSource).toBe('agents-md')
    }
  })

  it('gets a registration-sourced row and a vault-sourced row on screen', () => {
    expect(byId(REGISTRATION_ONLY).rosterSource).toBe('registered')
    expect(byId(VAULT_ONLY_ID).rosterSource).toBe('vault')
  })
})

describe('GET /api/agents — currentTaskSource says WHICH FACT currentTask is', () => {
  /**
   * THE MUTANT-KILLER. Flip `issue ? 'assigned-issue'` to `issue ? 'heartbeat'`
   * in app/api/agents/route.ts and this is the assertion that goes red.
   */
  it('emits "assigned-issue" for a task that came from the issues table', () => {
    const row = byId(ASSIGNED_ONLY)
    expect(row.currentTask).toBe('TOD-9001: assignee-sourced fixture')
    expect(row.currentTaskSource).toBe('assigned-issue')
    // And it is NOT the agent's own word — spelled out, because "not
    // 'heartbeat'" is the entire reason this field exists.
    expect(row.currentTaskSource).not.toBe('heartbeat')
  })

  it('emits "heartbeat" for a task the agent reported about itself', () => {
    const row = byId(HEARTBEAT_ONLY)
    expect(row.currentTask).toBe(HEARTBEAT_TASK)
    expect(row.currentTaskSource).toBe('heartbeat')
    // §2.4: workStartedAt belongs to the ISSUE branch only. A heartbeat-sourced
    // task must not borrow an unrelated start time.
    expect(row.workStartedAt).toBeNull()
  })

  it('when both exist the issue wins the string, and the source says so', () => {
    const row = byId(BOTH)
    expect(row.currentTask).toBe('TOD-9002: both-sources fixture')
    expect(row.currentTaskSource).toBe('assigned-issue')
  })

  it('emits "none" — and a null task — for an agent with neither', () => {
    const row = byId(NEITHER)
    expect(row.currentTask).toBeNull()
    expect(row.currentTaskSource).toBe('none')
  })

  it('never reports "none" alongside a task, nor a task alongside "none"', () => {
    for (const row of rows) {
      expect(['heartbeat', 'assigned-issue', 'none']).toContain(row.currentTaskSource)
      expect(row.currentTaskSource === 'none').toBe(!row.currentTask)
    }
  })
})

describe('the heartbeat-only builders never claim board evidence', () => {
  /**
   * §2.4 of the piece doc: `buildRegistrationAgent` and `buildVaultOnlyAgent`
   * are heartbeat-only BY CONSTRUCTION. The fixtures deliberately put an issues
   * row in front of each of them naming it as assignee; each row must still
   * report its own heartbeat, because that builder never looked at the table.
   */
  it('a registration-sourced row reports its heartbeat, not the issue naming it', () => {
    const row = byId(REGISTRATION_ONLY)
    expect(row.currentTaskSource).toBe('heartbeat')
    expect(row.currentTask).toBe('TOD-6666: registration heartbeat')
    expect(row.currentTask).not.toContain('TOD-9003')
  })

  it('a vault-sourced row reports its heartbeat, not the issue naming it', () => {
    const row = byId(VAULT_ONLY_ID)
    expect(row.currentTaskSource).toBe('heartbeat')
    expect(row.currentTask).toBe('TOD-5555: vault heartbeat')
    expect(row.currentTask).not.toContain('TOD-9004')
  })

  it('no non-agents-md row is ever "assigned-issue"', () => {
    for (const row of rows) {
      if (row.rosterSource !== 'agents-md') expect(row.currentTaskSource).not.toBe('assigned-issue')
    }
  })
})

describe('currentTaskLabel — the same fact, pre-worded, provenance FIRST', () => {
  it('leads with "assigned: " for a board row', () => {
    expect(byId(ASSIGNED_ONLY).currentTaskLabel).toBe('assigned: TOD-9001: assignee-sourced fixture')
  })

  it('leads with "reported: " for the agent own heartbeat', () => {
    expect(byId(HEARTBEAT_ONLY).currentTaskLabel).toBe(`reported: ${HEARTBEAT_TASK}`)
  })

  it('is null, not an empty string, when there is no task', () => {
    expect(byId(NEITHER).currentTaskLabel).toBeNull()
  })

  /**
   * The label and the source field are two renderings of one fact. If they can
   * disagree, a surface that renders the label and a surface that switches on
   * the source will say different things about the same row — which is the
   * defect this piece is named after, reintroduced one field along.
   */
  it('agrees with currentTaskSource on every row in the fleet', () => {
    for (const row of rows) {
      if (row.currentTaskSource === 'none') {
        expect(row.currentTaskLabel).toBeNull()
      } else if (row.currentTaskSource === 'heartbeat') {
        expect(row.currentTaskLabel).toBe(`reported: ${row.currentTask}`)
      } else {
        expect(row.currentTaskLabel).toBe(`assigned: ${row.currentTask}`)
      }
    }
  })

  it('never words a board row as something the agent reported', () => {
    for (const row of rows) {
      if (row.currentTaskSource === 'assigned-issue') {
        expect(row.currentTaskLabel?.startsWith('reported:')).toBe(false)
      }
    }
  })
})
