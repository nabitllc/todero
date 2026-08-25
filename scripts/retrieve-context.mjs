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

import { loadEnvFiles } from './lib/env-file.mjs'
import { importTs, REPO_ROOT } from './lib/ts-import.mjs'
import { requireNodeVersion } from './lib/node-version.mjs'

requireNodeVersion()
process.chdir(REPO_ROOT)
loadEnvFiles(REPO_ROOT)

const [agentId, taskKey, ...titleParts] = process.argv.slice(2)
if (!agentId || !taskKey) {
  console.error('usage: node scripts/retrieve-context.mjs <agent_id> <task_key> [task_title...]')
  process.exit(1)
}
const taskTitle = titleParts.join(' ')

const mod = await importTs('lib/memory-retrieval.ts')
if (!mod.ok) {
  console.error(`[retrieve-context] could not load lib/memory-retrieval.ts: ${mod.reason}`)
  process.exit(1)
}
const { buildRetrievedContext, RetrievalBudgetExceededError } = mod.module

try {
  const result = await buildRetrievedContext(agentId, taskKey, taskTitle)
  if (result.text) {
    process.stdout.write(result.text + '\n')
    console.error(
      `[retrieve-context] ${agentId}/${taskKey}: ${result.recordsUsed}/${result.recordsFound} record(s) ` +
        `injected via ${result.engine} search, ~${result.budgetTokens} token budget`,
    )
  } else {
    console.error(`[retrieve-context] ${agentId}/${taskKey}: no relevant past run records found (${result.engine} search)`)
  }
  process.exit(0)
} catch (err) {
  if (err instanceof RetrievalBudgetExceededError || err?.name === 'RetrievalBudgetExceededError') {
    console.error(`[retrieve-context] BUDGET EXCEEDED: ${err.message}`)
    process.exit(2)
  }
  console.error(`[retrieve-context] retrieval failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
