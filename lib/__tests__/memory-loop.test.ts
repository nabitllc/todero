/**
 * Round-3 repair: promoteHotPatterns() used to be non-idempotent on the
 * self_improving HOT-tier row it writes. Two runs over the SAME data (no new
 * agent_run_records) produced ONE row containing TWO identical
 * "#### Promoted <ts>" blocks — verified by running the loop end to end, not
 * by reading the code. That row is injected first in context loading, and the
 * 30_000-byte cap at app/api/run-agent/route.ts drops sections from the end,
 * so an unboundedly duplicating block silently evicted long-term/daily memory
 * a few passes in.
 *
 * This test runs promoteHotPatterns() twice over an unchanged set of rows
 * against a real (scratch) sqlite database and asserts the self_improving
 * row's content is byte-identical after the second call — the concrete
 * regression the fix exists to prevent — and separately proves the row is
 * bounded to MEMORY_BUDGET across many genuinely-new promotion rounds.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const AGENT_ID = 'critic-probe-idempotency-test'
const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')

describe('promoteHotPatterns idempotency (round-3 repair)', () => {
  let scratchDir: string
  let dbPath: string
  let vaultDir: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
    vaultDir: process.env.TODERO_VAULT_DIR,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-memory-loop-test-'))
    dbPath = join(scratchDir, 'db.sqlite')
    vaultDir = join(scratchDir, 'vault')
    mkdirSync(vaultDir, { recursive: true })

    // Build a fresh sqlite file the same way `npm run db:migrate` does for the
    // sqlite provider: apply every migrations/sqlite/*.sql in filename order.
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
    // Scratch vault only — the real READ-ONLY vault under
    // C:\Development\Mich-Brain2 must never be touched by this test.
    process.env.TODERO_VAULT_DIR = vaultDir
    closeHandles = []
  })

  afterEach(() => {
    // better-sqlite3 holds an OS-level file lock on Windows; each
    // jest.isolateModules() call below opens its own handle on the same
    // scratch file (module-scoped `handle` var, one per isolated registry),
    // and none of them auto-close. Close every one before deleting the
    // directory or rmSync fails with EPERM (the file is still locked).
    for (const close of closeHandles) close()
    closeHandles = []

    if (originalEnv.provider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = originalEnv.provider
    if (originalEnv.sqlitePath === undefined) delete process.env.TODERO_SQLITE_PATH
    else process.env.TODERO_SQLITE_PATH = originalEnv.sqlitePath
    if (originalEnv.vaultDir === undefined) delete process.env.TODERO_VAULT_DIR
    else process.env.TODERO_VAULT_DIR = originalEnv.vaultDir

    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true })
  })

  /**
   * Load memory-loop.ts and db.ts from the SAME isolated require registry, so
   * the `db()` this test reads with is the identical singleton instance
   * memory-loop.ts writes through internally (matching db-seam.test.ts's
   * `loadSeam()` pattern).
   */
  function loadModules() {
    let mods: { memoryLoop: typeof import('../memory-loop'); db: typeof import('../db').db }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const memoryLoop = require('../memory-loop') as typeof import('../memory-loop')
      const db = (require('../db') as typeof import('../db')).db
      const sqliteAdapter = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { memoryLoop, db }
    })
    return mods!
  }

  async function readSelfImproving(db: typeof import('../db').db): Promise<string | null> {
    const res = await db()
      .from('agent_memory_files')
      .select('content')
      .eq('agent_id', AGENT_ID)
      .eq('memory_type', 'self_improving')
      .is('date_key', null)
      .limit(1)
    const row = res.data?.[0] as { content?: string } | undefined
    return row?.content ?? null
  }

  it('leaves the self_improving row byte-identical on a second pass over unchanged data', async () => {
    const { memoryLoop, db } = loadModules()

    // Same rejection sentence, three times, with case/punctuation variation —
    // extractPatterns() normalizes these to one signature, so this clears the
    // (unchanged) threshold of 3 as exactly one pattern.
    const sentences = [
      'Build failed before responding: timeout waiting on step finish.',
      'build failed before responding: timeout waiting on step finish',
      'BUILD FAILED BEFORE RESPONDING: timeout waiting on step finish.',
    ]
    for (let i = 0; i < sentences.length; i++) {
      const err = await memoryLoop.writeRunRecord({
        agentId: AGENT_ID,
        taskKey: `TEST-${i}`,
        failed: true,
        rejectionReason: sentences[i],
      })
      expect(err).toBeNull()
    }

    // First pass: genuinely new pattern, HOT tier gets one block written.
    const first = await memoryLoop.promoteHotPatterns(AGENT_ID)
    expect(first.dbError).toBeUndefined()
    expect(first.rowsExamined).toBe(3)
    expect(first.hits).toHaveLength(1)
    expect(first.hits[0].count).toBe(3)
    expect(first.promotedToHot).toEqual([first.hits[0].phrase])
    expect(first.alreadyPromoted).toEqual([])

    const contentAfterFirst = await readSelfImproving(db)
    expect(contentAfterFirst).not.toBeNull()
    expect(contentAfterFirst).toContain(first.hits[0].phrase)
    // Exactly one promoted block after the first pass.
    expect(contentAfterFirst!.match(/#### Promoted /g) ?? []).toHaveLength(1)

    // Second pass over the SAME rows — no new agent_run_records at all.
    const second = await memoryLoop.promoteHotPatterns(AGENT_ID)
    expect(second.dbError).toBeUndefined()
    expect(second.rowsExamined).toBe(3)
    expect(second.hits).toHaveLength(1)
    // The regression: this used to be a second identical block. Now the
    // pattern is recognised as already promoted and dropped before the write.
    expect(second.promotedToHot).toEqual([])
    expect(second.alreadyPromoted).toEqual([second.hits[0].phrase])

    const contentAfterSecond = await readSelfImproving(db)
    expect(contentAfterSecond).toBe(contentAfterFirst)
    expect(Buffer.byteLength(contentAfterSecond ?? '', 'utf8')).toBe(
      Buffer.byteLength(contentAfterFirst ?? '', 'utf8'),
    )
    expect(contentAfterSecond!.match(/#### Promoted /g) ?? []).toHaveLength(1)
  })

  /**
   * Round-4 repair: the occurrence unit used to be one TEXT FIELD, not one
   * RUN RECORD. promoteHotPatterns() fed a row's rejection_reason and its
   * reviewer_notes into extractPatterns() as two independent entries, so a
   * single run whose rejection_reason and reviewer_notes normalize to the
   * same sentence (a reviewer echoing the rejection reason into their
   * notes, which is a routine thing for a reviewer to do) counted as TWO
   * occurrences of one run. Two such rows — two real runs — inflated to a
   * reported count of 4, clearing the (unchanged) threshold of 3 at ~1.5
   * real runs and drafting a vault proposal claiming
   * "Occurrences: 4 (threshold: 3)" backed by only 2 distinct tasks.
   *
   * This test seeds exactly that shape — 2 rows, each with the identical
   * phrase in BOTH rejection_reason and reviewer_notes — and asserts the
   * fixed count is 2 (one per row), which does not clear the threshold, so
   * nothing is promoted and no vault proposal is drafted.
   */
  it('extractPatterns counts a run record once, not once per text field, when rejection_reason and reviewer_notes normalize to the same phrase', () => {
    const { memoryLoop } = loadModules()

    const phrase = 'Reviewer rejected: missing regression test on the PATCH endpoint.'
    // Two runs (ids run-1, run-2), each contributing the SAME phrase from
    // BOTH its rejection_reason and its reviewer_notes — four text entries,
    // two distinct run records. Threshold dropped to 1 so the raw count is
    // observable directly, independent of any promotion gate.
    const texts = [
      { id: 'run-1', text: phrase, example: '[DUP-1] ' + phrase },
      { id: 'run-1', text: phrase, example: '[DUP-1] ' + phrase },
      { id: 'run-2', text: phrase, example: '[DUP-2] ' + phrase },
      { id: 'run-2', text: phrase, example: '[DUP-2] ' + phrase },
    ]

    const hits = memoryLoop.extractPatterns(texts, 1)
    expect(hits).toHaveLength(1)
    // The regression: this used to be 4 (one per text entry). It is now 2 —
    // one per distinct run record id.
    expect(hits[0].count).toBe(2)
  })

  it('promotes nothing when 2 run records duplicate the same phrase across both text columns (2 runs, not 3)', async () => {
    const { memoryLoop } = loadModules()

    const phrase = 'Reviewer rejected: missing regression test on the PATCH endpoint.'
    for (let i = 0; i < 2; i++) {
      const err = await memoryLoop.writeRunRecord({
        agentId: AGENT_ID,
        taskKey: `DUP-${i}`,
        failed: true,
        rejectionReason: phrase,
        reviewerNotes: phrase,
      })
      expect(err).toBeNull()
    }

    const summary = await memoryLoop.promoteHotPatterns(AGENT_ID)
    expect(summary.dbError).toBeUndefined()
    // Two run records examined, not four text entries.
    expect(summary.rowsExamined).toBe(2)
    // Before this fix, 2 rows x 2 duplicated columns inflated to a reported
    // count of 4, clearing the threshold of 3 at only 2 real runs and
    // drafting a vault proposal claiming 4 occurrences. Fixed: 2 real runs
    // is below threshold, so nothing is promoted and no proposal is drafted.
    expect(summary.hits).toEqual([])
    expect(summary.promotedToHot).toEqual([])
    expect(summary.proposals).toEqual([])
  })

  it('bounds the self_improving row to MEMORY_BUDGET, keeping the most recent blocks', async () => {
    const { memoryLoop, db } = loadModules()

    // Drive many SEPARATE promotion passes, each with its own genuinely new
    // pattern, so each call appends its own block — the shape a long-running
    // agent produces over weeks, not one big single-call write. ~140 bytes
    // per block x 100 rounds is well past MEMORY_BUDGET (8_000 bytes), so
    // trimming must actually engage.
    const rounds = 100
    for (let r = 0; r < rounds; r++) {
      for (let i = 0; i < 3; i++) {
        await memoryLoop.writeRunRecord({
          agentId: AGENT_ID,
          taskKey: `TEST-${r}-${i}`,
          failed: true,
          rejectionReason: `Round ${r} failure: distinct pattern number ${r} repeats here every time`,
        })
      }
      const summary = await memoryLoop.promoteHotPatterns(AGENT_ID)
      expect(summary.dbError).toBeUndefined()
    }

    const content = await readSelfImproving(db)
    expect(content).not.toBeNull()
    expect(Buffer.byteLength(content ?? '', 'utf8')).toBeLessThanOrEqual(memoryLoop.MEMORY_BUDGET)

    // The most recent round's block survived the trim...
    expect(content).toContain(`distinct pattern number ${rounds - 1} repeats`)
    // ...and the earliest round's block did not — it was the oldest, so it
    // was the first dropped when the row exceeded the ceiling.
    expect(content).not.toContain('distinct pattern number 0 repeats')
  }, 30_000)
})

/**
 * pieces7/memory-loop — recordRunOnExit() is the ONE function every runtime
 * adapter (claude-code.ts, codex.ts, cursor.ts, openai-api.ts) actually calls
 * from watchChildExit's onExit callback: it is the real hook between "a
 * dispatched agent's process exited" and a written agent_run_records row.
 * Despite that, it had zero test coverage anywhere in this repo before this
 * piece — every existing test in this file and in memory-retrieval.test.ts
 * seeds agent_run_records through writeRunRecord() directly, never through
 * the exit-time function that reads the issue row fresh.
 *
 * Verified live against the running dev server's own ./db.sqlite as part of
 * this piece (see docs/rebuild/pieces/pieces7/memory-loop.md) that a real
 * claudeCodeRuntime.spawn() → spawnDetached() → watchChildExit() → exactly
 * this function → INSERT chain fires end to end. This is the repeatable,
 * scratch-database version of that same proof, run against the function
 * directly so it does not depend on a live server or a real spawn.
 */
describe('recordRunOnExit — the real spawn-exit hook (previously untested)', () => {
  let scratchDir: string
  let dbPath: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-record-run-on-exit-test-'))
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
    let mods: { memoryLoop: typeof import('../memory-loop'); db: typeof import('../db').db }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const memoryLoop = require('../memory-loop') as typeof import('../memory-loop')
      const db = (require('../db') as typeof import('../db')).db
      const sqliteAdapter = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { memoryLoop, db }
    })
    return mods!
  }

  it('reads the issue row fresh and writes a matching agent_run_records row', async () => {
    const { memoryLoop, db } = loadModules()

    const insert = await db().from('issues').insert({
      id: 'issue-exit-1',
      task_key: 'TOD-9001',
      title: 'Fixture: exit-hook coverage',
      status: 'open',
      sprint: 'fixture',
      rejection_count: 2,
      last_rejection_reason: 'PATCH rejected: missing regression_test',
      reviewer_notes: 'same mistake as last time',
    })
    expect(insert.error).toBeNull()

    await memoryLoop.recordRunOnExit({ agentId: 'exit-hook-agent', taskId: 'issue-exit-1' })

    const { data } = await db()
      .from('agent_run_records')
      .select('*')
      .eq('agent_id', 'exit-hook-agent')
    const rows = (data ?? []) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      task_key: 'TOD-9001',
      status: 'open',
      rejection_count: 2,
      rejection_reason: 'PATCH rejected: missing regression_test',
      reviewer_notes: 'same mistake as last time',
    })
    // Genuinely unobservable from a pid-liveness watcher — never guessed.
    expect(rows[0].attempted).toBeNull()
    expect(rows[0].exit_status).toBeNull()
    expect(Boolean(rows[0].succeeded)).toBe(false)
  })

  it('writes nothing when no taskId is given — not every spawn attaches one', async () => {
    const { memoryLoop, db } = loadModules()
    await memoryLoop.recordRunOnExit({ agentId: 'exit-hook-agent' })
    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'exit-hook-agent')
    expect(data ?? []).toHaveLength(0)
  })

  it('writes nothing, and never throws, when taskId points at an issue that does not exist', async () => {
    const { memoryLoop, db } = loadModules()
    await expect(
      memoryLoop.recordRunOnExit({ agentId: 'exit-hook-agent', taskId: 'does-not-exist' }),
    ).resolves.toBeUndefined()
    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'exit-hook-agent')
    expect(data ?? []).toHaveLength(0)
  })

  it('writes nothing when the issue row has no task_key — agent_run_records.task_key is required', async () => {
    const { memoryLoop, db } = loadModules()
    const insert = await db().from('issues').insert({
      id: 'issue-exit-no-key',
      title: 'Fixture: issue with no task_key',
      status: 'open',
      sprint: 'fixture',
    })
    expect(insert.error).toBeNull()

    await memoryLoop.recordRunOnExit({ agentId: 'exit-hook-agent', taskId: 'issue-exit-no-key' })

    const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'exit-hook-agent')
    expect(data ?? []).toHaveLength(0)
  })
})
