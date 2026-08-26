/**
 * pieces8/memory-attempted, ROUND 2 — the regression this piece caused, and
 * the guard that closes it, both measured against a real sqlite DB built from
 * the real migrations.
 *
 * WHAT WENT WRONG. `agent_run_records.attempted` was null on every row this
 * system had ever written. pieces8/memory-attempted started filling it in,
 * with a 1,200-char cap (~300 tokens). `formatRecord()` renders `attempted`
 * ALONGSIDE the record's rejection reason and reviewer notes, and neither of
 * those is capped anywhere — so a record that fitted the 1,300-token
 * retrieval budget before this piece could exceed it after, and
 * `buildRetrievedContext()` would raise `RetrievalBudgetExceededError`, which
 * app/api/run-agent/route.ts answers with a 503 and a reset issue. Measured
 * before the fix, identical row and identical query, only `attempted`
 * toggled: null → OK at ~1,185 tokens; at the cap → threw at ~1,468. A
 * dispatch that worked yesterday returned 503 today because of a field that
 * was supposed to be an improvement.
 *
 * THE GUARD. `refitAttemptedToBudget()` hands this piece's own excerpt back —
 * clipped with an explicit marker, or omitted and disclosed — before the
 * budget is allowed to raise on the top-ranked record. The tests below pin
 * BOTH directions: the regression is gone, and the pre-piece overflow
 * behaviour (a record whose human-written text alone blows the budget still
 * raises, and is never silently chopped) is untouched.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ATTEMPTED_MAX_CHARS } from '../runtimes/exit-evidence'

const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')

/** The same query for every case, so "only `attempted` changed" is literally true. */
const TASK_TITLE = 'keyset pagination cursor'
const QUERY = 'keyset pagination cursor deadlock'

describe('buildRetrievedContext — this piece must not 503 a retrieval that worked before it (pieces8 round 2)', () => {
  let scratchDir: string
  let dbPath: string
  let closeHandles: Array<() => void> = []
  const originalEnv = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlitePath: process.env.TODERO_SQLITE_PATH,
    budget: process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS,
  }

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-attempted-budget-'))
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
    let mods: {
      db: typeof import('../db').db
      retrieval: typeof import('../memory-retrieval')
    }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const db = (require('../db') as typeof import('../db')).db
      const retrieval = require('../memory-retrieval') as typeof import('../memory-retrieval')
      const sqliteAdapter = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { db, retrieval }
    })
    return mods!
  }

  async function seedRecord(
    db: typeof import('../db').db,
    agentId: string,
    row: { attempted: string | null; reviewerNotes?: string | null; rejectionReason?: string | null },
  ) {
    const { error } = await db().from('agent_run_records').insert({
      id: `rec-${agentId}`,
      agent_id: agentId,
      task_key: 'TOD-9801',
      task_title: TASK_TITLE,
      attempted: row.attempted,
      rejection_reason: row.rejectionReason ?? null,
      reviewer_notes: row.reviewerNotes ?? null,
      succeeded: false,
      failed: true,
    })
    expect(error).toBeNull()
  }

  /** Long free text nobody capped — a real reviewer note is routinely this size. */
  function reviewerNotes(chars: number): string {
    return 'the reviewer explained at length that the keyset pagination cursor deadlocked '
      .repeat(Math.ceil(chars / 78))
      .slice(0, chars)
  }

  /**
   * THE REGRESSION, BOTH HALVES, IN ONE TEST. Identical row, identical query,
   * default budget — only `attempted` differs. Before the round-2 guard the
   * second half threw; the assertion `.not.toThrow()` is the whole point.
   */
  it('retrieves the same record whether or not attempted is set — the pre-piece row and the post-piece row', async () => {
    const { db, retrieval } = loadModules()
    const notes = reviewerNotes(4_600)

    // (a) the pre-piece row: attempted null. This is what every row in the
    // running product looked like before this piece.
    await seedRecord(db, 'agent-pre', { attempted: null, reviewerNotes: notes })
    const before = await retrieval.buildRetrievedContext('agent-pre', 'TOD-9900', QUERY)
    expect(before.recordsUsed).toBe(1)
    expect(before.attemptedRefit).toBeUndefined()

    // (b) the same row after this piece fills `attempted` in at its own cap.
    await seedRecord(db, 'agent-post', {
      attempted: `[run-exit] runtime=claude-code exit_code=1 outcome=failed ${'keyset cursor deadlock detail '.repeat(60)}`.slice(0, ATTEMPTED_MAX_CHARS),
      reviewerNotes: notes,
    })
    const after = await retrieval.buildRetrievedContext('agent-post', 'TOD-9900', QUERY)

    // It still retrieves. Before the guard this threw RetrievalBudgetExceededError
    // and app/api/run-agent/route.ts turned it into a 503 + a reset issue.
    expect(after.recordsUsed).toBe(1)
    expect(retrieval.estimateTokens(after.text)).toBeLessThanOrEqual(after.budgetTokens + 40)

    // What gave way is this piece's own excerpt, and it says so — in the
    // structured result, in the injected header, and inline.
    expect(after.attemptedRefit).toBeDefined()
    expect(after.attemptedRefit!.taskKey).toBe('TOD-9801')
    expect(after.attemptedRefit!.droppedChars).toBeGreaterThan(0)
    expect(after.text).toContain('Attempted excerpt')
    expect(after.text).toContain('agent_run_records.attempted for TOD-9801')

    // NOTHING A HUMAN WROTE IS SHORTENED. The reviewer's note is present in
    // full, byte for byte, in both renderings.
    expect(after.text).toContain(notes)
    expect(before.text).toContain(notes)
  })

  /**
   * PRE-PIECE PARITY. A record whose human-written text alone exceeds the
   * budget still raises — the guard hands back only `attempted`, and when
   * that is not enough the error is the same error, with the same code path
   * behind it (RETRIEVAL_BUDGET_EXCEEDED → 503, issue reset to pickupStatus).
   */
  it('still raises when the record overflows even with the attempted excerpt gone entirely', async () => {
    const { db, retrieval } = loadModules()
    await seedRecord(db, 'agent-huge', {
      attempted: 'x keyset pagination cursor '.repeat(44).slice(0, ATTEMPTED_MAX_CHARS),
      // Far past the budget on its own: no amount of giving `attempted` back
      // can make this fit, and chopping the reviewer's words is exactly what
      // this system refuses to do.
      reviewerNotes: reviewerNotes(20_000),
    })

    await expect(retrieval.buildRetrievedContext('agent-huge', 'TOD-9900', QUERY)).rejects.toThrow(
      retrieval.RetrievalBudgetExceededError,
    )
  })

  /** A record that fits whole must be injected whole — the guard must not clip opportunistically. */
  it('leaves a record that fits completely alone', async () => {
    const { db, retrieval } = loadModules()
    const attempted = '[run-exit] runtime=codex exit_code=9 outcome=failed keyset pagination cursor deadlock'
    await seedRecord(db, 'agent-small', { attempted, reviewerNotes: 'short note about the keyset cursor' })

    const result = await retrieval.buildRetrievedContext('agent-small', 'TOD-9900', QUERY)
    expect(result.recordsUsed).toBe(1)
    expect(result.attemptedRefit).toBeUndefined()
    expect(result.text).toContain(attempted)
    expect(result.text).not.toContain('clipped to fit')
  })

  /**
   * THE OMIT BRANCH. When the record fits without `attempted` but with only a
   * few tokens to spare, there is no room for an excerpt worth reading. The
   * excerpt is dropped — and the drop is announced, because an omission a
   * caller cannot see is the silent truncation this file exists to refuse.
   */
  it('omits — and discloses — the excerpt when there is no room for a readable one', async () => {
    const { db, retrieval } = loadModules()
    const budgetTokens = 400
    // Size the human-written half to land just under the budget, computed
    // rather than guessed so this test does not drift with the header format.
    const prefixBytes = Buffer.byteLength(`### TOD-9801 — ${TASK_TITLE}\nReviewer notes: `, 'utf8')
    const notes = reviewerNotes(budgetTokens * 4 - prefixBytes - 60)
    await seedRecord(db, 'agent-omit', {
      attempted: 'x keyset pagination cursor deadlock '.repeat(30).slice(0, ATTEMPTED_MAX_CHARS),
      reviewerNotes: notes,
    })

    const result = await retrieval.buildRetrievedContext('agent-omit', 'TOD-9900', QUERY, { budgetTokens })
    expect(result.recordsUsed).toBe(1)
    expect(result.attemptedRefit).toEqual(
      expect.objectContaining({ taskKey: 'TOD-9801', state: 'omitted' }),
    )
    expect(result.text).toContain('omitted')
    expect(result.text).toContain(notes)
  })
})
