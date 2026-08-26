/**
 * pieces9/memory-attempted — THE GAP THIS CLOSES.
 *
 * pieces8 filled in `agent_run_records.attempted` (feature #1 of the Hermes
 * benchmark: record what the run TRIED). Nobody ever measured what that did to
 * feature #2 (retrieve it on similar tasks). Measured here, and before this
 * piece the answer was: it halved it, silently.
 *
 * Real scratch sqlite built from migrations/sqlite/*.sql, real FTS5, 8 similar
 * past runs, one identical query, the default 1,300-token budget, and an
 * `attempted` produced by the REAL `summarizeExit()` for a claude-code run:
 *
 *   attempted: null  (every row ever written before pieces8)
 *     -> 8/8 records injected, ~120/1300 tokens
 *   attempted: filled
 *     -> 4/8 records injected, ~1112/1300 tokens
 *
 * Four past runs stopped reaching the prompt — and with them their
 * `rejection_reason` and `reviewer_notes`, human-written text this module
 * promises never to shorten. `attemptedRefit` stayed null (it only ever fires
 * for the TOP-ranked record), and the injected header read "4/8 match(es) fit",
 * byte-identical to what it would have said before the column existed. Nothing
 * anywhere said the new column was the cause.
 *
 * These tests pin the repair AND the two constants a mutation run walked
 * straight through.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SQLITE_MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations', 'sqlite')

/**
 * Duplicated from lib/memory-retrieval.ts ON PURPOSE, and it must stay a
 * literal here. The point of this number is the promise it encodes — "a
 * surviving excerpt is either long enough to tell a reader something, or it is
 * dropped and the drop is stated" — so a test that imported the constant would
 * move with any mutation of it and pin nothing. Measured with the constant set
 * to 1: the omit-and-disclose branch became unreachable and 92-character
 * excerpts were injected as `Attempted: ...`, which is exactly the "half a
 * record reads as the whole story" failure lib/memory-retrieval.ts's own header
 * says it refuses to commit.
 */
const MIN_READABLE_EXCERPT_CHARS = 120

const CLIP_MARKER = '… [clipped to fit the retrieval budget'
const OMIT_MARKER = '[omitted — '
const ATTEMPTED_PREFIX = 'Attempted: '

/** The `attempted` string a real claude-code run produces, via the real code path. */
function realAttempted(finalReportRepeats: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { summarizeExit } = require('../../lib/runtimes/exit-evidence')
  const evidence = summarizeExit({
    runtime: 'claude-code',
    exitCode: 0,
    durationSec: 41,
    reportedStatus: 'success',
    reportedError: false,
    turns: 12,
    tokensIn: 40213,
    tokensOut: 3311,
    finalReport: 'ran the suite and updated the piece doc. '.repeat(finalReportRepeats),
    logFile: '/var/log/todero/run-abc.log',
  })
  expect(typeof evidence.attempted).toBe('string')
  return evidence.attempted as string
}

describe('agent_run_records.attempted must not cost retrieval its reach (pieces9)', () => {
  let scratchDir: string
  let dbPath: string
  const savedEnv: Record<string, string | undefined> = {}
  const ENV_KEYS = ['TODERO_DB_PROVIDER', 'TODERO_SQLITE_PATH', 'TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS']

  /** Seed `count` similar past runs for one agent, all carrying `attempted`. */
  function seed(count: number, attempted: string | null): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    const insert = db.prepare(
      'INSERT INTO agent_run_records (agent_id, task_key, task_title, status, attempted, succeeded, failed, exit_status)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (let i = 1; i <= count; i++) {
      insert.run('builder', `LIM-${100 + i}`, 'sqlite migration mirror for the ledger table', 'done', attempted, 1, 0, 0)
    }
    db.close()
  }

  function setAttemptedOnAll(attempted: string | null): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    db.prepare('UPDATE agent_run_records SET attempted = ?').run(attempted)
    db.close()
  }

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-attempted-reach-'))
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
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    rmSync(scratchDir, { recursive: true, force: true })
  })

  it('reaches the same past runs with attempted filled as it did when the column was null', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildRetrievedContext } = require('../../lib/memory-retrieval')

    seed(8, null)
    const prePiece = await buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table')
    expect(prePiece.engine).toBe('fts5')
    expect(prePiece.recordsFound).toBe(8)
    expect(prePiece.recordsUsed).toBe(8)
    expect(prePiece.attemptedReach).toBeUndefined()

    setAttemptedOnAll(realAttempted(12))
    const postPiece = await buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table')

    // THE REGRESSION. Before this piece this number was 4.
    expect(postPiece.recordsFound).toBe(8)
    expect(postPiece.recordsUsed).toBe(prePiece.recordsUsed)

    // Reach means the RECORD arrives, not just the count.
    for (let i = 1; i <= 8; i++) expect(postPiece.text).toContain(`LIM-${100 + i}`)

    // And it is still inside the budget it claims to be inside.
    const used = /~(\d+)\/1300 tokens/.exec(postPiece.text)
    expect(used).not.toBeNull()
    expect(Number(used![1])).toBeLessThanOrEqual(1300)
  })

  it('states in the injected text itself that the attempted column shortened what it injected', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildRetrievedContext } = require('../../lib/memory-retrieval')
    seed(8, realAttempted(12))
    const r = await buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table')

    // Structured: a caller can see exactly what the column cost.
    expect(r.attemptedReach).toBeDefined()
    expect(r.attemptedReach.withoutAttempted).toBe(8)
    expect(r.attemptedReach.used).toBe(8)
    expect(r.attemptedReach.refitted).toBeGreaterThan(0)

    // In the text: whoever reads the spawn prompt sees only `text`. A header
    // identical to the pre-column one is the defect this assertion exists for.
    expect(r.text.split('\n')[0]).toMatch(/attempted excerpt\(s\) shortened/)
  })

  it('names the records it dropped when attempted, not the task, is why they are missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildRetrievedContext } = require('../../lib/memory-retrieval')
    // A budget too small for even the fair share to save every record. The
    // point is not that nothing is ever dropped; it is that a drop caused by
    // this column is never silent.
    seed(8, realAttempted(12))
    const r = await buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table', {
      budgetTokens: 200,
    })
    expect(r.recordsFound).toBe(8)
    expect(r.recordsUsed).toBeLessThan(8)
    expect(r.attemptedReach).toBeDefined()
    expect(r.attemptedReach.droppedTaskKeys.length).toBeGreaterThan(0)

    const header = r.text.split('\n')[0]
    expect(header).toContain('attempted cost reach')
    // Every dropped key is NAMED, not merely counted.
    for (const key of r.attemptedReach.droppedTaskKeys) expect(header).toContain(key)
  })

  it('never injects an excerpt too short to read — it omits it and says so instead', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildRetrievedContext } = require('../../lib/memory-retrieval')
    seed(6, realAttempted(40))

    // Two budgets that between them exercise BOTH branches of the threshold at
    // the shipped value: 400 lands in "no room for a readable excerpt" (omit),
    // 500 lands in "a readable excerpt survives" (clip). Round 2's tests
    // exercised both branches but pinned neither to a value; with the threshold
    // mutated to 1, budget 400 produces 92-character excerpts instead.
    for (const budgetTokens of [400, 500]) {
      const r = await buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table', {
        budgetTokens,
      })
      const attemptedLines: string[] = r.text.split('\n').filter((l: string) => l.startsWith(ATTEMPTED_PREFIX))
      expect(attemptedLines.length).toBeGreaterThan(0)

      for (const line of attemptedLines) {
        const body = line.slice(ATTEMPTED_PREFIX.length)
        if (body.startsWith(OMIT_MARKER)) continue // omitted AND disclosed — the honest branch
        const clipAt = body.indexOf(CLIP_MARKER)
        if (clipAt === -1) continue // nothing was cut
        expect(clipAt).toBeGreaterThanOrEqual(MIN_READABLE_EXCERPT_CHARS)
      }
    }
  })

  it('exercises both branches of the readable-excerpt threshold, so neither can rot untested', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildRetrievedContext } = require('../../lib/memory-retrieval')
    seed(6, realAttempted(40))
    const q = ['builder', 'LIM-999', 'sqlite migration mirror for the ledger table'] as const
    const tight = await buildRetrievedContext(q[0], q[1], q[2], { budgetTokens: 400 })
    const roomy = await buildRetrievedContext(q[0], q[1], q[2], { budgetTokens: 500 })
    expect(tight.text).toContain(OMIT_MARKER)
    expect(roomy.text).toContain(CLIP_MARKER)
  })

  it('still raises rather than truncating a record it cannot shrink honestly', async () => {
    // The one behaviour nothing above may have weakened: a record that does not
    // fit even with its machine-written excerpt gone entirely still raises,
    // because what would have to be cut next is the reviewer's own words.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const retrieval = require('../../lib/memory-retrieval')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    db.prepare(
      'INSERT INTO agent_run_records (agent_id, task_key, task_title, status, attempted, reviewer_notes, succeeded, failed)'
      + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('builder', 'LIM-500', 'sqlite migration mirror for the ledger table', 'done',
      realAttempted(12), 'the reviewer wrote this and it may never be shortened. '.repeat(200), 0, 1)
    db.close()

    await expect(
      retrieval.buildRetrievedContext('builder', 'LIM-999', 'sqlite migration mirror for the ledger table'),
    ).rejects.toThrow(retrieval.RetrievalBudgetExceededError)
  })
})

describe('summarizeExit — the per-line log-tail cap is load-bearing (pieces9)', () => {
  it('one runaway log line cannot crowd the other tail lines out of attempted', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { summarizeExit } = require('../../lib/runtimes/exit-evidence')

    // A log tail is the ONLY evidence codex and cursor ever produce — neither
    // writes a structured completion record. `TAIL_LINE_MAX_CHARS` exists, per
    // its own docstring, "so one enormous line cannot eat the whole budget".
    // Measured with it set to 200_000: `attempted` becomes 1,261 chars of the
    // runaway line, clipped at ATTEMPTED_MAX_CHARS, and tail lines two through
    // five are gone — and the entire suite still passed.
    const evidence = summarizeExit({
      runtime: 'codex',
      exitCode: 0,
      durationSec: 3,
      logTail: [
        'SENTINEL-ONE ' + 'x'.repeat(50_000),
        'SENTINEL-TWO writing file',
        'SENTINEL-THREE running tests',
        'SENTINEL-FOUR tests failed',
        'SENTINEL-FIVE giving up',
      ],
      logFile: '/var/log/todero/run-codex.log',
    })

    const attempted = evidence.attempted as string
    for (const sentinel of ['SENTINEL-ONE', 'SENTINEL-TWO', 'SENTINEL-THREE', 'SENTINEL-FOUR', 'SENTINEL-FIVE']) {
      expect(attempted).toContain(sentinel)
    }
    // The runaway line is present but bounded, and its truncation is marked.
    expect(attempted).not.toContain('x'.repeat(1_000))
    expect(attempted).toContain('truncated')
  })
})

describe('summarizeExit — the ledger status is derived, never assumed (pieces9)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { summarizeExit } = require('../../lib/runtimes/exit-evidence')

  it('a run that exited non-zero is not a completed ledger row', () => {
    const e = summarizeExit({ runtime: 'claude-code', exitCode: 9, durationSec: 5 })
    expect(e.failed).toBe(true)
    // lib/runtimes/claude-code.ts hardcoded 'completed' here, in the same
    // callback that produced `failed: true` four lines later.
    expect(e.ledgerStatus).toBe('failed')
  })

  it('a signalled run is killed, not completed', () => {
    const e = summarizeExit({ runtime: 'claude-code', exitCode: null, signal: 'SIGKILL', durationSec: 5 })
    expect(e.ledgerStatus).toBe('killed')
  })

  it('a run whose own trace never attested completion is unknown, not completed', () => {
    const e = summarizeExit({ runtime: 'openai-api', exitCode: 0, reportedStatus: 'running', durationSec: 5 })
    expect(e.outcome).toBe('unknown')
    expect(e.succeeded).toBe(false)
    expect(e.ledgerStatus).toBe('unknown')
  })

  it('a genuinely clean run is completed', () => {
    const e = summarizeExit({
      runtime: 'claude-code', exitCode: 0, reportedStatus: 'success', reportedError: false, durationSec: 5,
    })
    expect(e.ledgerStatus).toBe('completed')
  })
})
