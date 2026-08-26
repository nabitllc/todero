/**
 * TOD-2412 repair — POST /api/run-agent used to let RetrievalBudgetExceededError
 * (lib/memory-retrieval.ts, thrown from buildRetrievedContext when the single
 * top-ranked past record is too large to fit the context budget on its own —
 * a deliberate refusal to silently truncate it) escape uncaught. The only
 * `try` in the route wraps lines ~659-690 (the inbox-response lookup); the
 * call to `loadContextFromDB` at Step 9 sat outside any try/catch, so this
 * named, well-described exception reached the client as a bare Next.js 500
 * with none of the diagnostic fields (blockingRecordKey, blockTokens,
 * budgetTokens) the exception already carries.
 *
 * This test drives the REAL route handler (not a reimplementation of its
 * logic) through a real scratch sqlite database, all the way to Step 9,
 * mocking only the modules that are either (a) irrelevant to this code path
 * (permission/pause/budget/manifest gates — mocked to "allow", exactly what
 * an unconfigured dev host already resolves to) or (b) the thing under
 * test's actual trigger (`buildRetrievedContext`, mocked to throw the real,
 * unmodified `RetrievalBudgetExceededError` class so `instanceof` in the
 * route's catch block is exercised for real, not assumed).
 *
 * Proves three things by direct measurement, not by reading the code:
 *   1. The response is 503 with `code: 'RETRIEVAL_BUDGET_EXCEEDED'` and the
 *      exception's own token numbers and blocking-record key in the body.
 *   2. The claim taken in Step 5 is undone — the issue's status reverts to
 *      pickupStatus and started_at is cleared — so the next dispatch tick
 *      can retry instead of the issue sitting claimed with nothing running.
 *   3. The agent_runs row opened in Step 7 is marked 'error', not left at
 *      'running' forever.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')
const TEST_AGENT_ID = 'retrieval-budget-test-agent'

const FAKE_QUEUE_CONFIG = {
  agentId: TEST_AGENT_ID,
  model: 'sonnet' as const,
  pickupStatus: 'open',
  extraFilters: '',
  dorFields: [] as string[],
  wipLimit: 1,
  workingStatus: 'in_progress',
  completionStatus: 'code_review',
  checkBlocking: false,
  sortOrder: 'priority.asc',
  fetchLimit: 5,
  promptPrefix: 'Test agent.',
  // Sidesteps an unrelated sqlite-adapter quirk (lib/db/sqlite-adapter.ts,
  // not owned by this piece): the route hardcodes `is_blocked=eq.false` into
  // every non-skipAssigneeFilter lane's eligibility query, and the seam
  // deliberately keeps PostgREST-style filter values as strings ("the seam
  // serialises them back into the same comparison either way" —
  // lib/db/query-params.ts). Against Postgres that literal `'false'` casts
  // fine; against sqlite's BOOLEAN-affinity column it compares a bound TEXT
  // 'false' to a stored INTEGER 0 and matches nothing, independent of this
  // fix. `skipAssigneeFilter` (the same flag lib/agent-queue.ts's real
  // `main` lane already uses) drops that filter from the eligibility query
  // entirely, so this test exercises the route's actual claim → Step 9 →
  // catch logic without depending on that separate, unowned adapter gap.
  skipAssigneeFilter: true,
}

jest.mock('@/lib/permission-check', () => ({
  resolveCallerRole: async () => null,
  checkRoutePermission: async () => ({ allowed: true }),
}))
jest.mock('@/lib/hub-pause', () => ({ isHubPaused: async () => false }))
jest.mock('@/lib/loop-breaker', () => ({
  isAgentPaused: async () => false,
  recordAgentFailure: async () => {},
  resetAgentFailures: async () => {},
}))
jest.mock('@/lib/agent-budget', () => ({
  checkDispatchCeilings: async () => ({ allowed: true }),
}))
jest.mock('@/lib/agent-manifests', () => ({
  ensureVaultDispatchConfigs: async () => ({ warning: null }),
}))
jest.mock('@/lib/agent-queue', () => ({
  getQueueConfig: (agentId: string) => (agentId === TEST_AGENT_ID ? FAKE_QUEUE_CONFIG : undefined),
  getAllQueueAgentIds: () => [TEST_AGENT_ID],
}))
// The trigger under test: throw the REAL RetrievalBudgetExceededError class
// (via requireActual) so `err instanceof RetrievalBudgetExceededError` in the
// route's catch block is exercised against the genuine class, not a lookalike.
jest.mock('@/lib/memory-retrieval', () => {
  const actual = jest.requireActual('@/lib/memory-retrieval')
  return {
    ...actual,
    buildRetrievedContext: jest.fn(async () => {
      throw new actual.RetrievalBudgetExceededError(TEST_AGENT_ID, 'TOD-9300', 'TOD-9299', 16018, 1300)
    }),
  }
})

describe('POST /api/run-agent — RetrievalBudgetExceededError surfaces as a structured 503 (TOD-2412)', () => {
  let scratchDir: string
  let dbPath: string
  let issueId: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
    dispatchEnabled: process.env.TODERO_DISPATCH_ENABLED,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-run-agent-budget-test-'))
    dbPath = join(scratchDir, 'db.sqlite')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    const files = readdirSync(SQLITE_MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      db.exec(readFileSync(join(SQLITE_MIGRATIONS_DIR, file), 'utf8'))
    }
    db.close()

    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = dbPath
    // This test's own isolated module registry only — never the shared dev
    // server's env. The dispatch-disabled owner guard stays on everywhere
    // else; this just lets the isolated route instance reach Step 9.
    process.env.TODERO_DISPATCH_ENABLED = '1'
    closeHandles = []
    issueId = `issue-budget-${Date.now()}`
  })

  afterEach(() => {
    for (const close of closeHandles) close()
    closeHandles = []

    if (originalEnv.provider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = originalEnv.provider
    if (originalEnv.sqlitePath === undefined) delete process.env.TODERO_SQLITE_PATH
    else process.env.TODERO_SQLITE_PATH = originalEnv.sqlitePath
    if (originalEnv.dispatchEnabled === undefined) delete process.env.TODERO_DISPATCH_ENABLED
    else process.env.TODERO_DISPATCH_ENABLED = originalEnv.dispatchEnabled

    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true })
  })

  function loadModules() {
    let mods: {
      route: typeof import('@/app/api/run-agent/route')
      db: typeof import('@/lib/db').db
      NextRequest: typeof import('next/server').NextRequest
    }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const route = require('@/app/api/run-agent/route') as typeof import('@/app/api/run-agent/route')
      const db = (require('@/lib/db') as typeof import('@/lib/db')).db
      const { NextRequest } = require('next/server') as typeof import('next/server')
      const sqliteAdapter = require('@/lib/db/sqlite-adapter') as typeof import('@/lib/db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { route, db, NextRequest }
    })
    return mods!
  }

  async function seedEligibleIssue(db: typeof import('@/lib/db').db) {
    const { error } = await db().from('issues').insert({
      id: issueId,
      task_key: 'TOD-9300',
      title: 'Fixture: retrieval budget overflow route test',
      status: 'open',
      priority: 'medium',
      project: 'Limiglow',
      sprint: 'fixture',
      assignee: TEST_AGENT_ID,
      is_blocked: false,
      created_at: new Date().toISOString(),
    })
    expect(error).toBeNull()
  }

  it('answers 503 with code RETRIEVAL_BUDGET_EXCEEDED and the exception\'s own token numbers', async () => {
    const { route, db, NextRequest } = loadModules()
    await seedEligibleIssue(db)

    const req = new NextRequest(`http://localhost/api/run-agent?agent=${TEST_AGENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await route.POST(req)
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json).toMatchObject({
      code: 'RETRIEVAL_BUDGET_EXCEEDED',
      agent: TEST_AGENT_ID,
      taskKey: 'TOD-9300',
      blockingRecordKey: 'TOD-9299',
      blockTokens: 16018,
      budgetTokens: 1300,
    })
    expect(typeof json.error).toBe('string')
    expect(json.error).toContain('TOD-9299')
  })

  it('undoes the claim — issue reverts to pickupStatus, started_at cleared — instead of sitting claimed with nothing running', async () => {
    const { route, db, NextRequest } = loadModules()
    await seedEligibleIssue(db)

    const req = new NextRequest(`http://localhost/api/run-agent?agent=${TEST_AGENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await route.POST(req)

    const { data } = await db().from('issues').select('status,started_at').eq('id', issueId).limit(1)
    const row = ((data ?? [])[0] ?? {}) as { status?: string; started_at?: string | null }
    expect(row.status).toBe('open')
    expect(row.started_at).toBeNull()
  })

  it('marks the agent_runs row opened at claim time as error, not left at running', async () => {
    const { route, db, NextRequest } = loadModules()
    await seedEligibleIssue(db)

    const req = new NextRequest(`http://localhost/api/run-agent?agent=${TEST_AGENT_ID}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    await route.POST(req)

    const { data } = await db().from('agent_runs').select('status,error').eq('task_id', issueId)
    const rows = (data ?? []) as Array<{ status?: string; error?: string | null }>
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('error')
    expect(rows[0].error).toContain('TOD-9299')
  })
})
