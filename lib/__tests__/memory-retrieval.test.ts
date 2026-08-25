/**
 * memory-loop-retrieval piece — the read half of the learning loop.
 *
 * Proves the three things the piece brief actually asks for, against a real
 * (scratch) sqlite database with migration 041's FTS5 index applied — not
 * just that the functions exist, but that they behave:
 *
 *   1. FTS5 search over agent_run_records genuinely RANKS: a record whose
 *      text overlaps the query heavily outranks one that barely overlaps,
 *      and an irrelevant record is excluded entirely.
 *   2. Retrieval is capped by a hard, configurable token budget.
 *   3. Overflow on the single most relevant record RAISES
 *      (RetrievalBudgetExceededError) rather than silently truncating it —
 *      the exact discipline the piece brief names, mirroring
 *      memory-loop.ts's PromotionBlockTooLargeError on the write side.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const AGENT_ID = 'critic-probe-retrieval-test'
const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')

describe('memory-loop-retrieval (FTS5 search, ranking, hard budget)', () => {
  let scratchDir: string
  let dbPath: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
    budget: process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-memory-retrieval-test-'))
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
    delete process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS
    closeHandles = []
  })

  afterEach(() => {
    for (const close of closeHandles) close()
    closeHandles = []

    if (originalEnv.provider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = originalEnv.provider
    if (originalEnv.sqlitePath === undefined) delete process.env.TODERO_SQLITE_PATH
    else process.env.TODERO_SQLITE_PATH = originalEnv.sqlitePath
    if (originalEnv.budget === undefined) delete process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS
    else process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS = originalEnv.budget

    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true })
  })

  function loadModules() {
    let mods: { retrieval: typeof import('../memory-retrieval'); memoryLoop: typeof import('../memory-loop') }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const retrieval = require('../memory-retrieval') as typeof import('../memory-retrieval')
      const memoryLoop = require('../memory-loop') as typeof import('../memory-loop')
      const sqliteAdapter = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { retrieval, memoryLoop }
    })
    return mods!
  }

  it('FTS5-ranks records that overlap the query above ones that do not, and excludes irrelevant ones', async () => {
    const { retrieval, memoryLoop } = loadModules()

    await memoryLoop.writeRunRecord({
      agentId: AGENT_ID,
      taskKey: 'TOD-100',
      taskTitle: 'Fix login bug',
      failed: true,
      attempted: 'patched auth.ts',
      rejectionReason: 'forgot to add regression_test field on the PATCH',
      reviewerNotes: 'PATCH rejected: missing regression_test',
    })
    await memoryLoop.writeRunRecord({
      agentId: AGENT_ID,
      taskKey: 'TOD-200',
      taskTitle: 'Fix logout bug',
      failed: true,
      attempted: 'patched session teardown',
      rejectionReason: 'forgot regression_test again on the PATCH endpoint',
      reviewerNotes: 'same mistake as TOD-100',
    })
    await memoryLoop.writeRunRecord({
      agentId: AGENT_ID,
      taskKey: 'TOD-300',
      taskTitle: 'Add dark mode toggle',
      failed: true,
      attempted: 'added a CSS class',
      rejectionReason: 'unrelated failure: build timeout waiting on a slow CI runner',
      reviewerNotes: 'infra flake, not the agent',
    })

    const { records, engine } = await retrieval.searchRunRecords(AGENT_ID, 'PATCH missing regression_test', 10)
    expect(engine).toBe('fts5')
    // Both PATCH/regression_test records rank ahead of the unrelated dark-mode one.
    expect(records.map(r => r.taskKey).slice(0, 2).sort()).toEqual(['TOD-100', 'TOD-200'])
    expect(records.find(r => r.taskKey === 'TOD-300')).toBeUndefined()
    // FTS5's bm25() convention: lower rank is more relevant.
    expect(records[0].rank).toBeLessThanOrEqual(records[1].rank)
  })

  it('only returns another agent\'s records when searched under that agent — never bleeds across agents', async () => {
    const { retrieval, memoryLoop } = loadModules()
    await memoryLoop.writeRunRecord({
      agentId: 'some-other-agent',
      taskKey: 'OTHER-1',
      failed: true,
      rejectionReason: 'regression_test missing on PATCH',
    })
    const { records } = await retrieval.searchRunRecords(AGENT_ID, 'regression_test PATCH', 10)
    expect(records).toEqual([])
  })

  it('buildRetrievedContext selects whole records under the configured budget, never a partial one', async () => {
    const { retrieval, memoryLoop } = loadModules()
    for (let i = 0; i < 5; i++) {
      await memoryLoop.writeRunRecord({
        agentId: AGENT_ID,
        taskKey: `BUDGET-${i}`,
        taskTitle: 'Fix login timeout',
        failed: true,
        rejectionReason: `login timeout attempt ${i}: same recurring failure pattern`,
      })
    }

    // A budget wide enough for a couple of records but not all five.
    const result = await retrieval.buildRetrievedContext(AGENT_ID, 'BUDGET-X', 'Fix login timeout', { budgetTokens: 60 })
    expect(result.recordsFound).toBe(5)
    expect(result.recordsUsed).toBeGreaterThan(0)
    expect(result.recordsUsed).toBeLessThan(5)
    expect(result.text).toContain('BUDGET-')
    // Every included record is emitted whole — its own "### KEY" header — never a fragment.
    const headers = result.text.match(/^### /gm) ?? []
    expect(headers.length).toBe(result.recordsUsed)
  })

  it('raises RetrievalBudgetExceededError — does not truncate — when the top-ranked record alone exceeds the budget', async () => {
    const { retrieval, memoryLoop } = loadModules()
    await memoryLoop.writeRunRecord({
      agentId: AGENT_ID,
      taskKey: 'HUGE-1',
      taskTitle: 'Fix login timeout',
      failed: true,
      rejectionReason: 'login timeout '.repeat(200), // large enough to blow a tiny budget alone
    })

    await expect(
      retrieval.buildRetrievedContext(AGENT_ID, 'HUGE-1', 'Fix login timeout', { budgetTokens: 5 }),
    ).rejects.toBeInstanceOf(retrieval.RetrievalBudgetExceededError)
  })

  it('returns an empty (not thrown) result when nothing matches — empty is not an overflow', async () => {
    const { retrieval } = loadModules()
    const result = await retrieval.buildRetrievedContext(AGENT_ID, 'NOPE-1', 'nothing indexed yet')
    expect(result.text).toBe('')
    expect(result.recordsUsed).toBe(0)
  })

  it('the budget is configurable via TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS, and small by default', () => {
    const { retrieval } = loadModules()
    expect(retrieval.getContextBudgetTokens()).toBe(retrieval.CONTEXT_BUDGET_TOKENS_DEFAULT)
    expect(retrieval.CONTEXT_BUDGET_TOKENS_DEFAULT).toBeLessThanOrEqual(2_000) // "small by default"

    process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS = '4000'
    const { retrieval: retrieval2 } = loadModules()
    expect(retrieval2.getContextBudgetTokens()).toBe(4000)
  })
})
