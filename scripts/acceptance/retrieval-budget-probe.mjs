#!/usr/bin/env node
// retrieval-budget-probe.mjs — the behavioural half of the `retrieval-is-budgeted`
// acceptance check (pieces9/memory-attempted, seam 3).
//
// WHY THIS FILE EXISTS. The check used to decide "budget enforced by raising,
// not truncating" from two `countMatches()` greps over lib/ and scripts/ source
// TEXT. Comments satisfy both, and this repo has written a great many comments
// containing the word `budget` next to the word `Error`. Measured by the lane
// that opened this seam: replacing the `throw new RetrievalBudgetExceededError(…)`
// in lib/memory-retrieval.ts with a silent `block.slice(0, budgetTokens * 4)` —
// the precise behaviour the check claims to forbid — left the harness reporting
// `PASS retrieval-is-budgeted`, 45/45, 10/10. A grader that cannot fail inflates
// the score of every piece it grades.
//
// So this probe RUNS the real function instead of reading its source:
//
//   1. builds a scratch SQLite database in a temp directory from the real
//      migrations/sqlite/*.sql — the live database is never opened, never
//      written, never read;
//   2. seeds ONE run record whose human-written `reviewer_notes` alone are far
//      past any budget (nothing here may be shortened — that is the rule under
//      test);
//   3. calls the real `buildRetrievedContext()` with a 50-token budget.
//
// It prints exactly one verdict line and exits 0 only on the first:
//
//   RAISED:RetrievalBudgetExceededError   the contract holds
//   TRUNCATED:<chars>:…                   it returned text instead of raising — the bug
//   PROBE-BROKEN:<reason>                 the probe itself did not measure anything
//                                         (store unreachable, fixture unfindable,
//                                         module unloadable). NOT a pass, and not
//                                         a silent one either.
//
// argv[2] optionally names a different repo-relative module to load, defaulting
// to the shipped `lib/memory-retrieval.ts`. The acceptance check never passes
// one. It exists so that "prove this check can go red" can be demonstrated
// against a deliberately-broken COPY, without editing the module the running
// product imports.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { importTs, REPO_ROOT } from '../lib/ts-import.mjs'

const modulePath = process.argv[2] || 'lib/memory-retrieval.ts'

/** Long free text nobody caps — a real reviewer note is routinely this size. */
const REVIEWER_NOTES =
  'the reviewer explained at length that the keyset pagination cursor deadlocked '.repeat(260)
const TASK_TITLE = 'keyset pagination cursor'
const QUERY = 'keyset pagination cursor deadlock'

const say = (line, code) => { console.log(line); process.exitCode = code }

const scratchDir = mkdtempSync(join(tmpdir(), 'todero-retrieval-budget-probe-'))
const dbPath = join(scratchDir, 'db.sqlite')

try {
  const require = createRequire(import.meta.url)
  const Database = require('better-sqlite3')
  const migrationsDir = join(REPO_ROOT, 'migrations', 'sqlite')

  const scratch = new Database(dbPath)
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
    scratch.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  scratch
    .prepare(
      `INSERT INTO agent_run_records
         (id, agent_id, task_key, task_title, attempted, reviewer_notes, succeeded, failed)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
    )
    .run(
      'retrieval-budget-probe',
      'retrieval-budget-probe-agent',
      'TOD-9801',
      TASK_TITLE,
      '[run-exit] runtime=probe exit_code=1 outcome=failed keyset pagination cursor deadlock',
      REVIEWER_NOTES,
    )
  scratch.close()

  // Point the app's own database seam at the scratch file for this process only.
  process.env.TODERO_DB_PROVIDER = 'sqlite'
  process.env.TODERO_SQLITE_PATH = dbPath
  delete process.env.TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS

  const mod = await importTs(modulePath)
  if (!mod.ok) {
    say(`PROBE-BROKEN:could not load ${modulePath}: ${mod.reason}`, 1)
  } else {
    try {
      const result = await mod.module.buildRetrievedContext(
        'retrieval-budget-probe-agent',
        'TOD-9900',
        QUERY,
        { budgetTokens: 50 },
      )
      // Reaching here at all means it did NOT raise. Say which flavour of
      // not-raising it was, because "the store was empty" and "it truncated
      // the reviewer's words" are different facts and neither is a pass.
      if (result.availability === 'unavailable') {
        say(`PROBE-BROKEN:store unavailable (${result.unavailableReason ?? 'no reason given'})`, 1)
      } else if (!result.recordsFound) {
        say('PROBE-BROKEN:the seeded record was not found by search — the probe measured nothing', 1)
      } else {
        say(`TRUNCATED:${(result.text ?? '').length}:used=${result.recordsUsed}/${result.recordsFound}`, 1)
      }
    } catch (err) {
      say(`RAISED:${err?.name ?? 'unknown'}`, err?.name === 'RetrievalBudgetExceededError' ? 0 : 1)
    }
  }

  // Release the sqlite handle before deleting the file — Windows refuses to
  // unlink an open one, and a probe that leaves a temp database behind on
  // every acceptance run is its own small defect.
  const adapter = await importTs('lib/db/sqlite-adapter.ts')
  if (adapter.ok) { try { adapter.module.closeSqlite() } catch { /* already closed */ } }
} catch (err) {
  say(`PROBE-BROKEN:${err instanceof Error ? err.message : String(err)}`, 1)
} finally {
  try { rmSync(scratchDir, { recursive: true, force: true }) } catch { /* temp dir; the OS will get it */ }
}
