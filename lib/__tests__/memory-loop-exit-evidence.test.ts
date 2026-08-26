/**
 * pieces8/memory-attempted — the end-to-end proof, against a real sqlite file
 * built from the real migrations.
 *
 * THE GAP THIS CLOSES. Every row `recordRunOnExit()` had ever written carried
 * `attempted: null`, `succeeded: 0`, `exit_status: null`. A memory could say
 * "TOD-167 was open and someone rejected it"; it could never say "I tried X
 * and it failed". The benchmark this channel is measured against (Hermes)
 * records what a run TRIED and retrieves it on a similar later task.
 *
 * These tests assert the whole chain on real data, in this order:
 *   1. observed evidence actually lands in the four columns,
 *   2. a caller that observed nothing still gets the historical row shape,
 *   3. a FAILED run is retrievable, by FTS5, from a DIFFERENT later task
 *      whose query overlaps only what the earlier run TRIED — the exact
 *      Hermes behaviour, which was impossible while `attempted` was null.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')

describe('recordRunOnExit — observed exit evidence reaches the row (pieces8)', () => {
  let scratchDir: string
  let dbPath: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-exit-evidence-loop-'))
    dbPath = join(scratchDir, 'db.sqlite')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    for (const file of readdirSync(SQLITE_MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(SQLITE_MIGRATIONS_DIR, file), 'utf8'))
    }
    db.close()

    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = dbPath
    closeHandles = []
  })

  afterEach(() => {
    for (const close of closeHandles) close()
    closeHandles = []
    if (originalEnv.provider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = originalEnv.provider
    if (originalEnv.sqlitePath === undefined) delete process.env.TODERO_SQLITE_PATH
    else process.env.TODERO_SQLITE_PATH = originalEnv.sqlitePath
    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true })
  })

  function loadModules() {
    let mods: {
      memoryLoop: typeof import('../memory-loop')
      db: typeof import('../db').db
      retrieval: typeof import('../memory-retrieval')
    }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const memoryLoop = require('../memory-loop') as typeof import('../memory-loop')
      const db = (require('../db') as typeof import('../db')).db
      const retrieval = require('../memory-retrieval') as typeof import('../memory-retrieval')
      const sqliteAdapter = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { memoryLoop, db, retrieval }
    })
    return mods!
  }

  async function seedIssue(db: typeof import('../db').db, row: Record<string, unknown>) {
    const { error } = await db().from('issues').insert(row)
    expect(error).toBeNull()
  }

  it('persists attempted / succeeded / failed / exit_status when the caller observed them', async () => {
    const { memoryLoop, db } = loadModules()
    await seedIssue(db, {
      id: 'issue-ev-1',
      task_key: 'TOD-9401',
      title: 'Webhook retry loop has no backoff and times out under load',
      status: 'in_review',
      sprint: 'fixture',
      rejection_count: 0,
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { summarizeExit } = require('../runtimes/exit-evidence') as typeof import('../runtimes/exit-evidence')
    const evidence = summarizeExit({
      runtime: 'claude-code',
      exitCode: 0,
      durationSec: 412,
      reportedStatus: 'success',
      reportedError: false,
      turns: 9,
      tokensIn: 13_402,
      tokensOut: 2_210,
      finalReport: 'Added exponential backoff with a 250ms base delay to the webhook retry loop.',
    })

    await memoryLoop.recordRunOnExit({
      agentId: 'ev-agent',
      taskId: 'issue-ev-1',
      attempted: evidence.attempted,
      succeeded: evidence.succeeded,
      failed: evidence.failed,
      exitStatus: evidence.exitStatus,
    })

    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'ev-agent')
    const rows = (data ?? []) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    const row = rows[0]

    expect(row.task_key).toBe('TOD-9401')
    // exit_status is a REAL captured code now, not null.
    expect(row.exit_status).toBe(0)
    // succeeded/failed are declared INTEGER on sqlite; the seam decodes them
    // to real booleans (BOOLEAN_MEANING_OVERRIDES, pieces7/boolean-columns).
    expect(row.succeeded === true || row.succeeded === 1).toBe(true)
    expect(row.failed === false || row.failed === 0).toBe(true)
    // ...and `attempted` finally says something.
    expect(row.attempted).not.toBeNull()
    expect(String(row.attempted)).toContain('runtime=claude-code')
    expect(String(row.attempted)).toContain('exit_code=0')
    expect(String(row.attempted)).toContain('reported_status=success')
    expect(String(row.attempted)).toContain('exponential backoff')
  })

  it('reproduces the historical row exactly when the caller observed nothing', async () => {
    const { memoryLoop, db } = loadModules()
    await seedIssue(db, {
      id: 'issue-ev-2',
      task_key: 'TOD-9402',
      title: 'Fixture: no evidence available',
      status: 'open',
      sprint: 'fixture',
      rejection_count: 0,
    })

    // No evidence fields at all — the pre-pieces8 call shape, still supported.
    await memoryLoop.recordRunOnExit({ agentId: 'ev-none-agent', taskId: 'issue-ev-2' })

    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'ev-none-agent')
    const rows = (data ?? []) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].attempted).toBeNull()
    expect(rows[0].exit_status).toBeNull()
    expect(rows[0].succeeded === false || rows[0].succeeded === 0).toBe(true)
    expect(rows[0].failed === false || rows[0].failed === 0).toBe(true)
  })

  it('records a max_iterations run as FAILED even though its process exited 0', async () => {
    const { memoryLoop, db } = loadModules()
    await seedIssue(db, {
      id: 'issue-ev-3',
      task_key: 'TOD-9403',
      title: 'Fixture: ran out of iterations',
      status: 'in_progress',
      sprint: 'fixture',
      rejection_count: 0,
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { summarizeExit } = require('../runtimes/exit-evidence') as typeof import('../runtimes/exit-evidence')
    const evidence = summarizeExit({
      runtime: 'openai-api',
      exitCode: 0,
      reportedStatus: 'max_iterations',
      turns: 12,
      toolsUsed: ['read_file', 'edit_file', 'run_tests'],
    })
    await memoryLoop.recordRunOnExit({
      agentId: 'ev-maxiter-agent',
      taskId: 'issue-ev-3',
      attempted: evidence.attempted,
      succeeded: evidence.succeeded,
      failed: evidence.failed,
      exitStatus: evidence.exitStatus,
    })

    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'ev-maxiter-agent')
    const row = ((data ?? []) as Array<Record<string, unknown>>)[0]
    expect(row.exit_status).toBe(0)
    expect(row.failed === true || row.failed === 1).toBe(true)
    expect(row.succeeded === false || row.succeeded === 0).toBe(true)
    expect(String(row.attempted)).toContain('tools invoked (3')
  })

  /**
   * THE BENCHMARK BEHAVIOUR. A run FAILS at one task; a genuinely different
   * later task, with a different issue key and no shared title vocabulary,
   * retrieves that failure by FTS5 purely on what the earlier run TRIED.
   *
   * The query below deliberately shares NOTHING with the earlier issue's
   * title ("Fixture: unrelated title, shares no vocabulary with the query")
   * — the only overlap is with the `attempted` text. Before this piece
   * `attempted` was null on every lifecycle-written row, so this retrieval
   * was structurally impossible; that is the defect, stated as a test.
   */
  it('retrieves a past FAILURE on a later task by what the run tried, not by the issue title', async () => {
    const { memoryLoop, db, retrieval } = loadModules()
    await seedIssue(db, {
      id: 'issue-ev-4',
      task_key: 'TOD-9404',
      title: 'Fixture: unrelated title, shares no vocabulary with the query',
      status: 'open',
      sprint: 'fixture',
      rejection_count: 0,
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { summarizeExit } = require('../runtimes/exit-evidence') as typeof import('../runtimes/exit-evidence')
    const evidence = summarizeExit({
      runtime: 'claude-code',
      exitCode: 1,
      durationSec: 88,
      reportedStatus: 'error_during_execution',
      reportedError: true,
      finalReport: 'Tried to migrate the pagination cursor to a keyset scan; the keyset query deadlocked against the archiver.',
      logFile: '/logs/TOD-9404.log',
    })
    expect(evidence.failed).toBe(true)

    await memoryLoop.recordRunOnExit({
      agentId: 'ev-recall-agent',
      taskId: 'issue-ev-4',
      attempted: evidence.attempted,
      succeeded: evidence.succeeded,
      failed: evidence.failed,
      exitStatus: evidence.exitStatus,
    })

    // A LATER, different task. Its key (TOD-9500) is stripped by
    // significantTerms(); the issue title above shares no words with it.
    const result = await retrieval.searchRunRecords(
      'ev-recall-agent',
      'TOD-9500 keyset pagination cursor deadlocks against the archiver',
      8,
    )
    expect(result.availability).toBe('available')
    expect(result.engine).toBe('fts5')
    expect(result.records.map(r => r.taskKey)).toContain('TOD-9404')
    const matched = result.records.find(r => r.taskKey === 'TOD-9404')!
    expect(matched.attempted).toContain('keyset')
    expect(matched.attempted).toContain('deadlocked')

    // And it survives the whole way into the injected prompt block.
    const built = await retrieval.buildRetrievedContext(
      'ev-recall-agent',
      'TOD-9500',
      'keyset pagination cursor deadlocks against the archiver',
    )
    expect(built.recordsUsed).toBe(1)
    expect(built.text).toContain('Attempted:')
    expect(built.text).toContain('keyset query deadlocked')
  })
})
