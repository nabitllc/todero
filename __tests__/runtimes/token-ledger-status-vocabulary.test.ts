/**
 * pieces9/memory-attempted — token_ledger.status could not hold the outcomes
 * the runtimes actually observe, and losing the write lost the MONEY too.
 *
 * MEASURED before the repair, on a scratch sqlite built from the real
 * migrations/sqlite/*.sql:
 *
 *   UPDATE token_ledger SET status='max_iterations', input_tokens=111,
 *     cost_usd=0.5, completed_at=…
 *   -> CHECK constraint failed: (status IN ('spawned','completed','failed','killed'))
 *   -> row left {status:'spawned', completed_at:null, input_tokens:null, cost_usd:null}
 *
 * Control, the same statement with status='completed': the row updates with
 * input_tokens=111 and cost_usd=0.5. So the failure was not "the status word is
 * missing" — it was that the ENTIRE update was rejected, so every openai-api run
 * that exhausted MAX_ITER, or died before writing a `run_end` line, silently
 * lost its tokens, its cost and its completion. migrations/038 documents that
 * exact state as budget-corrupting. The comment sitting above the call
 * (lib/runtimes/openai-api.ts) asserted the opposite the whole time.
 *
 * Two states are pinned here, because both are real deployments:
 *   - migration 075 applied      -> the real word is recorded verbatim
 *   - migration 075 NOT applied  -> the numbers survive, the real word is kept
 *     on the row in metadata.reported_status, and the narrowing is disclosed.
 *     This is not hypothetical: PostgREST (this repo's default adapter) has no
 *     DDL grammar, and migration 054 has never applied on the owner's install
 *     for exactly that reason.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SQLITE_MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations', 'sqlite')
const LOG_FILE = '/var/log/todero/vocabulary-fixture.log'

describe('finalizeRun must never lose a run’s tokens and cost to the status column (pieces9)', () => {
  let scratchDir: string
  let dbPath: string
  const savedEnv: Record<string, string | undefined> = {}
  const ENV_KEYS = ['TODERO_DB_PROVIDER', 'TODERO_SQLITE_PATH']
  let closeHandles: Array<() => void> = []

  /** Build a scratch DB from the real migrations, optionally WITHOUT 075. */
  function buildDb(opts: { withStatusVocabularyMigration: boolean }): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    const files = readdirSync(SQLITE_MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (!opts.withStatusVocabularyMigration && file.startsWith('075_')) continue
      db.exec(readFileSync(join(SQLITE_MIGRATIONS_DIR, file), 'utf8'))
    }
    // Mark EVERY migration applied — including the one deliberately skipped.
    //
    // Without this, lib/db/boot-migrate.ts runs on the first db() call and
    // applies 075 itself, so the "column is still narrow" case would quietly
    // stop testing a narrow column. It happens to survive today only because
    // boot-migrate aborts on 038's non-idempotent ADD COLUMN before ever
    // reaching 075 — i.e. this test's determinism would otherwise rest on an
    // unrelated migration continuing to fail. Recording the ledger rows makes
    // the intended state the ACTUAL state.
    // Same DDL lib/db/boot-migrate.ts uses; the table is created by the boot
    // step, not by any migration file, so it does not exist yet here.
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations ('
      + '  filename   TEXT PRIMARY KEY,'
      + "  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
      + ')',
    )
    const record = db.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)')
    for (const file of files) record.run(file)
    db.prepare(
      "INSERT INTO token_ledger (agent_id, runtime, prompt_bytes, log_file, status) VALUES (?, ?, ?, ?, 'spawned')",
    ).run('tester', 'openai-api', 42, LOG_FILE)
    db.close()
  }

  /** Load finalizeRun and the DB seam as one isolated graph, after the env is set. */
  function loadLedger() {
    let mods!: {
      finalizeRun: typeof import('../../lib/runtimes/token-ledger').finalizeRun
      db: typeof import('../../lib/db').db
    }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const db = (require('../../lib/db') as typeof import('../../lib/db')).db
      const sqliteAdapter = require('../../lib/db/sqlite-adapter') as typeof import('../../lib/db/sqlite-adapter')
      const { finalizeRun } = require('../../lib/runtimes/token-ledger') as typeof import('../../lib/runtimes/token-ledger')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { finalizeRun, db }
    })
    return mods
  }

  /** finalizeRun is fire-and-forget, so poll for the closed row. */
  async function waitForClosedRow(db: typeof import('../../lib/db').db): Promise<Record<string, unknown>> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      const { data } = await db().from('token_ledger').select('*').eq('log_file', LOG_FILE)
      const rows = (data ?? []) as Array<Record<string, unknown>>
      if (rows.length > 0 && rows[0].status !== 'spawned') return rows[0]
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('token_ledger row never closed within 10s')
  }

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-ledger-vocab-'))
    dbPath = join(scratchDir, 'db.sqlite')
    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = dbPath
    closeHandles = []
  })

  afterEach(() => {
    for (const close of closeHandles) close()
    closeHandles = []
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]!
    }
    rmSync(scratchDir, { recursive: true, force: true })
  })

  it('records max_iterations verbatim once migration 075 has applied', async () => {
    buildDb({ withStatusVocabularyMigration: true })
    const { finalizeRun, db } = loadLedger()

    finalizeRun({ logFile: LOG_FILE, status: 'max_iterations', inputTokens: 111, outputTokens: 22, costUsd: 0.5 })
    const row = await waitForClosedRow(db)

    expect(row.status).toBe('max_iterations')
    expect(row.input_tokens).toBe(111)
    expect(row.output_tokens).toBe(22)
    expect(Number(row.cost_usd)).toBeCloseTo(0.5)
    expect(row.completed_at).not.toBeNull()
  })

  it('keeps the tokens, the cost and the real word when the column is still narrow', async () => {
    buildDb({ withStatusVocabularyMigration: false })
    const { finalizeRun, db } = loadLedger()

    finalizeRun({ logFile: LOG_FILE, status: 'max_iterations', inputTokens: 111, outputTokens: 22, costUsd: 0.5 })
    const row = await waitForClosedRow(db)

    // THE MONEY SURVIVES. This is the assertion that matters: before the
    // degrade these were all null and the row was still 'spawned'.
    expect(row.input_tokens).toBe(111)
    expect(row.output_tokens).toBe(22)
    expect(Number(row.cost_usd)).toBeCloseTo(0.5)
    expect(row.completed_at).not.toBeNull()

    // The narrower word is CHECK-legal, and it is never 'completed' — a run
    // that hit the iteration cap did not finish, and /api/costs/breakdown and
    // the budget both read 'completed' as "this run did its job".
    expect(row.status).toBe('failed')
    expect(row.status).not.toBe('completed')

    // And the run's OWN word is on the same row, so the narrowing is a
    // disclosed projection rather than a fabrication.
    const metadata = row.metadata as Record<string, unknown> | null
    expect(metadata).not.toBeNull()
    expect(metadata!.reported_status).toBe('max_iterations')
    expect(String(metadata!.status_column_narrowed)).toContain('075_token_ledger_status_vocabulary.sql')
  })

  it('does not narrow a status the column can already hold', async () => {
    buildDb({ withStatusVocabularyMigration: false })
    const { finalizeRun, db } = loadLedger()

    finalizeRun({ logFile: LOG_FILE, status: 'failed', inputTokens: 7, costUsd: 0.01 })
    const row = await waitForClosedRow(db)

    expect(row.status).toBe('failed')
    // No degrade happened, so no disclosure is invented.
    const metadata = row.metadata as Record<string, unknown> | null
    expect(metadata?.reported_status).toBeUndefined()
  })
})
