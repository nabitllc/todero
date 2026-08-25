#!/usr/bin/env node
// retrieve-context.mjs — memory-loop-retrieval piece.
//
// Ranked, budgeted retrieval from the run-record store, for one agent and one
// task. This is what `scripts/spawn-context.sh` now calls instead of `cat`ting
// `self-improving/corrections.md` wholesale — see `lib/memory-retrieval.ts` for
// the search + budget logic itself; this is a thin, portable CLI wrapper
// around it, same shape as `scripts/promote-hot-patterns.mjs`.
//
// Usage:
//   node scripts/retrieve-context.mjs <agent_id> <task_key> [task_title...]
//
// Exit codes:
//   0  — printed a context block (possibly empty — "nothing relevant" is not
//        a failure) to stdout.
//   1  — usage error.
//   2  — RetrievalBudgetExceededError: the single most relevant record could
//        not fit inside the configured budget. Printed to STDERR, and the
//        process exits non-zero — the point of this exit code existing at
//        all is that a caller sourcing this script's stdout under `set -e`
//        (as spawn-context.sh does) fails loudly instead of silently
//        injecting a truncated record.
//
// Exit discipline: this process must NEVER call `process.exit()` itself.
// On the supabase provider, the "store unavailable" path has already made an
// HTTP request (via the Supabase SDK's fetch) that failed — and calling
// `process.exit()` while that request's underlying socket/keep-alive handle
// is still being torn down hits a genuine libuv race on Windows
// (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
// src\win\async.c, line 94`), which aborts the process with exit code 127 —
// not the exit code this script ever intends to produce, and one that looks
// nothing like the deliberate 0/1/2 contract above. Reproduced
// deterministically (3/3) with `process.exit(0)` called immediately after a
// failed `fetch()`; letting the event loop drain naturally after the same
// failed fetch exits cleanly every time. So every path below only sets
// `process.exitCode` and returns — Node exits on its own once the event loop
// is empty, which also gives any pending handle from a failed request time to
// finish closing before the process actually goes down.

import { loadEnvFiles } from './lib/env-file.mjs'
import { importTs, REPO_ROOT } from './lib/ts-import.mjs'
import { requireNodeVersion } from './lib/node-version.mjs'

requireNodeVersion()
process.chdir(REPO_ROOT)
loadEnvFiles(REPO_ROOT)

const [agentId, taskKey, ...titleParts] = process.argv.slice(2)
if (!agentId || !taskKey) {
  console.error('usage: node scripts/retrieve-context.mjs <agent_id> <task_key> [task_title...]')
  process.exitCode = 1
} else {
  const taskTitle = titleParts.join(' ')

  const mod = await importTs('lib/memory-retrieval.ts')
  if (!mod.ok) {
    console.error(`[retrieve-context] could not load lib/memory-retrieval.ts: ${mod.reason}`)
    process.exitCode = 1
  } else {
    const { buildRetrievedContext, RetrievalBudgetExceededError } = mod.module

    try {
      const result = await buildRetrievedContext(agentId, taskKey, taskTitle)
      if (result.availability === 'unavailable') {
        // NOT the same message as "searched, found nothing" below — the store
        // itself could not be reached (sqlite file/FTS table missing, postgres
        // table missing, a query error), so nothing was actually observed. A
        // caller reading this as a clean negative would be trusting a search
        // that never happened. This distinction must survive on STDOUT, not
        // just stderr — spawn-context.sh (and anything else composing agent
        // context) only reads stdout, so if the honest wording lived only in
        // the stderr diagnostic below, every caller would still see empty
        // stdout and fall back to "no past run record ranked relevant to this
        // task", which is exactly the false negative this piece exists to kill.
        console.error(
          `[retrieve-context] ${agentId}/${taskKey}: RETRIEVAL UNAVAILABLE — the ${result.engine} store could not be ` +
            `searched (${result.unavailableReason ?? 'unknown reason'}). This is NOT "no relevant records found"; it is ` +
            `"nothing was observed". Proceeding with no injected context.`,
        )
        process.stdout.write(
          `_(retrieval unavailable — the ${result.engine} store could not be searched: ` +
            `${result.unavailableReason ?? 'unknown reason'}; this is NOT "no relevant records")_\n`,
        )
      } else if (result.text) {
        process.stdout.write(result.text + '\n')
        console.error(
          `[retrieve-context] ${agentId}/${taskKey}: ${result.recordsUsed}/${result.recordsFound} record(s) ` +
            `injected via ${result.engine} search, ~${result.budgetTokens} token budget`,
        )
      } else if (result.engine === 'keyword-overlap' && result.possiblyIncompleteScan) {
        // Not the same claim as the branch below: this engine has no index,
        // so "no matches" only means none turned up inside the most recent
        // `scannedWindowRows` records it was able to look at — an older,
        // genuinely relevant record may sit past that window and this run
        // never saw it. Reporting a bounded scan as a completed search is the
        // exact defect this piece exists to close. Same stdout-vs-stderr
        // reasoning as the unavailable branch above: the caveat must be on
        // the channel spawn-context.sh actually reads.
        console.error(
          `[retrieve-context] ${agentId}/${taskKey}: no relevant records found in the ${result.scannedWindowRows} ` +
            `most recent run records (${result.engine} search, bounded — older records were not scanned and may contain a match)`,
        )
        process.stdout.write(
          `_(no match inside the ${result.scannedWindowRows} most recent run records — older records were not scanned)_\n`,
        )
      } else {
        console.error(`[retrieve-context] ${agentId}/${taskKey}: no relevant past run records found (${result.engine} search)`)
      }
      process.exitCode = 0
    } catch (err) {
      if (err instanceof RetrievalBudgetExceededError || err?.name === 'RetrievalBudgetExceededError') {
        console.error(`[retrieve-context] BUDGET EXCEEDED: ${err.message}`)
        process.exitCode = 2
      } else {
        console.error(`[retrieve-context] retrieval failed: ${err instanceof Error ? err.message : String(err)}`)
        process.exitCode = 1
      }
    }
  }
}
