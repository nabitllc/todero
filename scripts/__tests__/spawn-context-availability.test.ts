/**
 * memory-loop-retrieval piece, round 2 — the honesty leak.
 *
 * lib/memory-retrieval.ts already tells the truth internally (see
 * lib/__tests__/memory-retrieval*.test.ts): a store that could not be
 * searched at all comes back as `availability: 'unavailable'`, distinct from
 * a genuine "searched, found nothing". The bug this test guards against was
 * never in that library — it was in the two thin wrappers around it:
 *
 *   - scripts/retrieve-context.mjs used to print the honest "RETRIEVAL
 *     UNAVAILABLE" sentence to STDERR only, leaving STDOUT empty for that
 *     case exactly like the real "nothing relevant" case.
 *   - scripts/spawn-context.sh only ever reads retrieve-context.mjs's
 *     STDOUT, and its own fallback for empty stdout was the confident
 *     negative "no past run record ranked relevant to this task" — which is
 *     false when the reason stdout was empty is that the store itself could
 *     not be searched.
 *
 * This drives the real composed context through `bash spawn-context.sh`
 * end to end, against a real sqlite file whose `agent_run_records` table
 * exists but whose FTS index migration (041) was never applied — the
 * concrete "run-record table missing" condition — and asserts the honest
 * sentence survives onto the channel the agent's context is actually built
 * from, and the false negative does not.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const REPO_ROOT = join(__dirname, '..', '..')
const AGENT_ID = 'critic-probe-spawn-context-test'
const TASK_KEY = 'TOD-9001'
const TASK_TITLE = 'Add dark mode toggle to settings'

describe('spawn-context.sh honestly distinguishes "store unavailable" from "nothing relevant"', () => {
  let scratchDir: string
  let dbPath: string
  let workspaceDir: string

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'todero-spawn-context-test-'))
    dbPath = join(scratchDir, 'db.sqlite')
    workspaceDir = join(scratchDir, 'workspace')

    // Base table present (migration 040) but the FTS index (041) is NOT
    // applied — the run-record table the search needs is missing, even
    // though the database file itself, and the plain agent_run_records
    // table, both exist. This is what makes searchSqliteFts() throw "no
    // such table: agent_run_records_fts" and report availability:
    // 'unavailable' rather than a clean empty search.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    db.exec(readFileSync(join(REPO_ROOT, 'migrations', 'sqlite', '000_baseline.sql'), 'utf8'))
    db.exec(readFileSync(join(REPO_ROOT, 'migrations', 'sqlite', '040_agent_run_records.sql'), 'utf8'))
    db.close()
  })

  afterEach(() => {
    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true })
  })

  it('composed context contains "retrieval unavailable" and does NOT contain "no past run record ranked relevant"', () => {
    const stdout = execFileSync(
      'bash',
      [join(REPO_ROOT, 'scripts', 'spawn-context.sh'), workspaceDir, AGENT_ID, TASK_KEY, TASK_TITLE],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TODERO_DB_PROVIDER: 'sqlite',
          TODERO_SQLITE_PATH: dbPath,
        },
        encoding: 'utf8',
      },
    )

    expect(stdout).toContain('retrieval unavailable')
    expect(stdout).not.toContain('no past run record ranked relevant')
  })

  it('memory-retrieval-relevance round 4: a corrupt store (not a database file, no "no such table" message anywhere) still reports "retrieval unavailable", never the false negative', () => {
    // Round-4 critic finding: searchSqliteFts() used to classify ONLY the
    // literal "no such table" driver error as `availability: 'unavailable'`
    // — every other store failure (a locked file, corruption, the
    // constructor itself throwing) degraded to `'available'` with zero
    // records, and this exact script then printed the false negative
    // "no past run record ranked relevant to this task" over a store it
    // never actually searched. Reproduce that condition for real: overwrite
    // dbPath with plain text, so `better-sqlite3` throws "file is not a
    // database" — a message containing neither "no such table" nor anything
    // that string-matched the old special case.
    const { writeFileSync } = require('fs') as typeof import('fs')
    writeFileSync(dbPath, 'this is not a sqlite database file')

    const stdout = execFileSync(
      'bash',
      [join(REPO_ROOT, 'scripts', 'spawn-context.sh'), workspaceDir, AGENT_ID, TASK_KEY, TASK_TITLE],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TODERO_DB_PROVIDER: 'sqlite',
          TODERO_SQLITE_PATH: dbPath,
        },
        encoding: 'utf8',
      },
    )

    expect(stdout).toContain('retrieval unavailable')
    expect(stdout).toContain('file is not a database')
    expect(stdout).not.toContain('no past run record ranked relevant')
  })

  it('by contrast, a genuinely empty (but available) store DOES fall back to "no past run record ranked relevant"', () => {
    // Sanity check the test above is not vacuous: apply the FTS migration
    // too, so the store is fully available and genuinely has nothing for
    // this agent/task. That's the one case where the old fallback wording
    // is actually correct.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    db.exec(readFileSync(join(REPO_ROOT, 'migrations', 'sqlite', '041_agent_run_records_fts.sql'), 'utf8'))
    db.close()

    const stdout = execFileSync(
      'bash',
      [join(REPO_ROOT, 'scripts', 'spawn-context.sh'), workspaceDir, AGENT_ID, TASK_KEY, TASK_TITLE],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TODERO_DB_PROVIDER: 'sqlite',
          TODERO_SQLITE_PATH: dbPath,
        },
        encoding: 'utf8',
      },
    )

    expect(stdout).toContain('no past run record ranked relevant')
    expect(stdout).not.toContain('retrieval unavailable')
  })
})
