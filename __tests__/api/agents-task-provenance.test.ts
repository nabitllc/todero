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
// ROUND 3. Two more roster agents, each named by an issues row that the route's
// query is supposed to REFUSE. They exist so that deleting a clause changes the
// response, not just the recorded query — see the stub's header.
const DONE_ROW_AGENT = 'scout' // named only by a `done` issue
const ARCHIVED_ROW_AGENT = 'auditor' // named only by an ARCHIVED in_progress issue
// Named by an issue whose `key + title` is comfortably over the 80-char wire
// cap, so that removing `.slice(0, 80)` CHANGES THE RESPONSE. Without a row
// like this the cap assertion is vacuously true and the mutant survives — it
// did, on the first attempt at this test.
const LONG_TITLE_AGENT = 'designer'
const LONG_TITLE =
  'a deliberately long issue title that runs well past the eighty character wire cap so the slice has something to cut'


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
  // ── Rows the query must exclude. Both name a real AGENTS.md agent, so if
  //    either clause is dropped they land on the roster as
  //    "assigned: TOD-90xx: …" — finished or archived work, rendered as work
  //    in progress.
  {
    // Excluded by `.in('status', [...])`: 'done' is not an active status.
    task_key: 'TOD-9005', title: 'finished work that must not render as current', status: 'done',
    assignee: DONE_ROW_AGENT, worked_by: null, updated_at: iso(30_000), started_at: iso(90_000),
    archived_at: null,
  },
  {
    // Excluded by `.is('archived_at', null)`: an ACTIVE status, but archived.
    // This is the row the status list alone cannot stop.
    task_key: 'TOD-9006', title: 'archived work that must not render as current', status: 'in_progress',
    assignee: ARCHIVED_ROW_AGENT, worked_by: null, updated_at: iso(30_000), started_at: iso(90_000),
    archived_at: iso(10_000),
  },
  {
    // Admitted by every clause — it exists to exercise the LENGTH cap.
    task_key: 'TOD-9007', title: LONG_TITLE, status: 'in_progress',
    assignee: LONG_TITLE_AGENT, worked_by: null, updated_at: iso(60_000), started_at: iso(60_000),
    archived_at: null,
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

/**
 * Every query the route issued, in order. There is exactly ONE `GET()` in this
 * file (the `beforeAll` below), so this array holds that request's queries and
 * is never reset; a second request would append rather than replace.
 *
 * ─── ROUND 3: WHY THE STUB STOPPED BEING A NO-OP ─────────────────────────────
 *
 * The previous version of this stub built a chain whose every method was
 * `() => chain` and then resolved with EVERY fixture row for the table,
 * regardless of what was asked. That is a mock of the client's shape, not of
 * its behaviour, and it made the filters invisible: a critic deleted
 * `.in('status', [...])` from the issues query in app/api/agents/route.ts and
 * all 141 lane tests stayed green. The clause that decides which issues count
 * as "current work" was completely unguarded — with it gone, a `done` or
 * `archived` row renders on the roster as "assigned: TOD-X: …", a finished
 * ticket presented as work in progress.
 *
 * Two changes close it, and they are deliberately redundant:
 *
 *   1. The stub APPLIES `.in()`, `.eq()` and `.is()` to the fixture rows. A
 *      deleted clause now changes the DATA, so the existing assertions about
 *      what lands on the roster start failing on their own.
 *   2. The stub RECORDS each call. A test can then assert the query itself,
 *      which catches the case where today's fixtures happen not to contain a
 *      row that the missing clause would have admitted.
 *
 * (1) alone would be defeated by a fixture set with nothing to exclude; (2)
 * alone would be defeated by a clause that is recorded but wrong. Together
 * they need two different lies to stay green.
 */
type RecordedQuery = { table: string; select?: string; in: [string, unknown[]][]; is: [string, unknown][]; eq: [string, unknown][] }
const recordedQueries: RecordedQuery[] = []

/** The recorded query against `table`, or undefined when it was never read. */
function queryFor(table: string): RecordedQuery | undefined {
  return recordedQueries.find(q => q.table === table)
}

jest.mock('@/lib/db', () => ({
  db: () => ({
    from: (table: string) => {
      const q: RecordedQuery = { table, in: [], is: [], eq: [] }
      recordedQueries.push(q)
      let rows = [...((mockTables[table] as Record<string, unknown>[] | undefined) ?? [])]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chainable Supabase stub
      const chain: any = {}
      // Pass-through shaping methods: recorded where useful, never filtering.
      chain.select = (cols?: string) => { q.select = cols; return chain }
      for (const m of ['order', 'limit', 'single', 'maybeSingle', 'upsert']) chain[m] = () => chain
      // Filtering methods: recorded AND applied.
      chain.in = (col: string, vals: unknown[]) => {
        q.in.push([col, vals])
        rows = rows.filter(r => vals.includes(r[col]))
        return chain
      }
      chain.eq = (col: string, val: unknown) => {
        q.eq.push([col, val])
        rows = rows.filter(r => r[col] === val)
        return chain
      }
      chain.is = (col: string, val: unknown) => {
        q.is.push([col, val])
        // Supabase `.is(col, null)` means IS NULL; undefined counts as absent.
        rows = rows.filter(r => (val === null ? r[col] === null || r[col] === undefined : r[col] === val))
        return chain
      }
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

/**
 * ─── ROUND 3: THE FOUR MUTANTS THAT SURVIVED ROUND 2 ─────────────────────────
 *
 * A fresh-context critic applied ten mutations to this lane's product code and
 * reverted them. Six were caught by name. The four below were not: all 141 lane
 * tests stayed green and `npx tsc --noEmit` stayed clean while the mutation was
 * live. Each `it` here is named for the mutant it kills, so a future critic can
 * re-apply the mutation and read the failure rather than take this on trust.
 */
describe('mutants that survived round 2 — the query that decides "current work"', () => {
  /**
   * MUTANT: delete `.in('status', [...])` from the issues query
   *         (app/api/agents/route.ts).
   *
   * Caught twice over. The DATA assertion below fails because TOD-9005 is
   * `done` and would reach the roster; the RECORD assertion fails because the
   * clause is simply gone. The old stub could see neither — it returned every
   * fixture row for `issues` no matter what was asked.
   */
  it('MUTANT deleting .in(status): a `done` issue never renders as current work', () => {
    const row = byId(DONE_ROW_AGENT)
    expect(row.currentTaskSource).toBe('none')
    expect(row.currentTask).toBeNull()
    expect(row.currentTaskLabel).toBeNull()
  })

  it('MUTANT deleting .in(status): the status filter is actually in the query', () => {
    const q = queryFor('issues')
    expect(q).toBeDefined()
    const statusFilter = q!.in.find(([col]) => col === 'status')
    expect(statusFilter).toBeDefined()
    // The five statuses that mean "somebody could be working on this now".
    expect(statusFilter![1]).toEqual(['open', 'in_progress', 'code_review', 'product_review', 'approved'])
    // And the terminal states are NOT among them.
    for (const terminal of ['done', 'archived', 'cancelled', 'backlog']) {
      expect(statusFilter![1]).not.toContain(terminal)
    }
  })

  /**
   * ROUND 3 FIX, not a surviving mutant: the query carried NO archive clause,
   * while /api/issues refuses to serve archived rows on every read. An archived
   * issue in an active status was therefore eligible to render on the roster as
   * current work. Latent on this host (measured 2026-08-26: `issues` holds 2
   * rows and the one archived row is `backlog`, which the status list already
   * excludes) — but nothing keeps it latent.
   */
  it('an ARCHIVED issue in an active status never renders as current work', () => {
    const row = byId(ARCHIVED_ROW_AGENT)
    expect(row.currentTaskSource).toBe('none')
    expect(row.currentTask).toBeNull()
    expect(row.currentTaskLabel).toBeNull()
  })

  it('the archive clause is actually in the query', () => {
    const q = queryFor('issues')
    expect(q!.is).toContainEqual(['archived_at', null])
  })

  /**
   * MUTANT: `workStartedAt: issue?.startedAt ?? null` -> `workStartedAt: null`.
   *
   * `workStartedAt` is the SOLE input to describeActivity's "It has been in
   * progress 3h." clause — the only duration evidence on an assigned row. The
   * round-2 suite asserted only that it is null on a heartbeat row, so nothing
   * objected when every row's start time was deleted.
   */
  it('MUTANT workStartedAt:null — an assigned row carries the board start time', () => {
    const row = byId(ASSIGNED_ONLY)
    expect(row.currentTaskSource).toBe('assigned-issue')
    expect(row.workStartedAt).not.toBeNull()
    expect(typeof row.workStartedAt).toBe('number')
    // It is the fixture's own started_at, not "now" and not the updated_at.
    expect(row.workStartedAt).toBe(new Date(iso(60_000)).getTime())
  })

  it('a heartbeat-sourced task still borrows no start time', () => {
    const row = byId(HEARTBEAT_ONLY)
    expect(row.currentTaskSource).toBe('heartbeat')
    expect(row.workStartedAt).toBeNull()
  })

  /**
   * MUTANT: remove `.slice(0, 80)` from the issue task string.
   *
   * Minor, and pinned because it was unpinned: the wire cap is what keeps a
   * long issue title from blowing out the single-line surfaces that render
   * `currentTaskLabel`.
   */
  it('MUTANT removing .slice(0,80) — the issue task string is capped at 80', () => {
    // The fixture is chosen so the uncapped string would be far longer than
    // the cap; asserting `<= 80` against a short title proves nothing, which
    // is how this mutant survived its first guard.
    const uncapped = `TOD-9007: ${LONG_TITLE}`
    expect(uncapped.length).toBeGreaterThan(80)

    const row = byId(LONG_TITLE_AGENT)
    expect(row.currentTaskSource).toBe('assigned-issue')
    expect(row.currentTask).toBe(uncapped.slice(0, 80))
    expect(row.currentTask!.length).toBe(80)

    // The cap applies to the raw task; the label adds its provenance word on
    // top, so the label is allowed to be longer than 80.
    expect(row.currentTaskLabel).toBe(`assigned: ${row.currentTask}`)
  })
})
