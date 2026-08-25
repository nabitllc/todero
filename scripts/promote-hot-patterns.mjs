#!/usr/bin/env node
// promote-hot-patterns.mjs — reviews recent corrections and promotes
// repeating patterns to the HOT tier (TOD-489 repair)
//
// Replaces promote-hot-patterns.sh, which hardcoded MC_DIR to one developer's
// mission-control checkout and read workspace-<agent>/self-improving/
// corrections.md off disk — dead on any other machine, and increasingly dead
// on THIS one too since post-task-memory.sh already moved writes to the DB
// (TOD-2230) while this script kept reading the abandoned Markdown files.
//
// Usage:
//   node scripts/promote-hot-patterns.mjs [agent_id ...]   # specific agents
//   node scripts/promote-hot-patterns.mjs                   # builder tester designer
//
// Logic (kept identical to TOD-489's already-tuned behaviour, see
// lib/memory-loop.ts):
//   1. Reads this agent's failed/rejected rows from agent_run_records.
//   2. Groups by repeated significant word in rejection_reason / reviewer_notes.
//   3. A pattern appearing >= 3 times is promoted: appended to the
//      self_improving HOT tier (agent_memory_files), and drafted as a skill
//      proposal into Mich-Brain2/_pending/skill-updates/ — the only vault
//      path Todero may write, for a human to approve by hand
//      (docs/brain2-integration.md). Never auto-approved.
//
// Intended to be run on a schedule (or via POST /api/promote-hot-patterns,
// which calls the same lib/memory-loop.ts function).

import { loadEnvFiles } from './lib/env-file.mjs'
import { importTs, REPO_ROOT } from './lib/ts-import.mjs'
import { requireNodeVersion } from './lib/node-version.mjs'

requireNodeVersion()
process.chdir(REPO_ROOT)
loadEnvFiles(REPO_ROOT)

const DEFAULT_AGENTS = ['builder', 'tester', 'designer']
const agents = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_AGENTS

const log = (line) => console.log(`[promote-hot] ${line}`)

const memoryMod = await importTs('lib/memory-loop.ts')
if (!memoryMod.ok) {
  console.error(`[promote-hot] could not load lib/memory-loop.ts: ${memoryMod.reason}`)
  process.exit(1)
}
const { promoteHotPatterns, PROMOTION_THRESHOLD } = memoryMod.module

for (const agentId of agents) {
  const summary = await promoteHotPatterns(agentId)
  log(`${agentId}: ${summary.rowsExamined} failed/rejected run record(s) examined`)

  if (summary.rowsExamined < PROMOTION_THRESHOLD) {
    log(`${agentId}: below threshold (${PROMOTION_THRESHOLD}) — skipping promotion`)
    continue
  }
  if (summary.hits.length === 0) {
    log(`${agentId}: no pattern meets the threshold — skipping`)
    continue
  }

  for (const hit of summary.hits) {
    log(`${agentId}: pattern "${hit.word}" appeared ${hit.count} time(s)`)
  }
  if (summary.promotedToHot.length > 0) {
    log(`${agentId}: promoted to HOT tier: ${summary.promotedToHot.join(', ')}`)
  } else {
    log(`${agentId}: HOT-tier write did not confirm — see agent_memory_files directly`)
  }
  for (const proposal of summary.proposals) {
    if (proposal.written) {
      log(`${agentId}: vault proposal drafted -> ${proposal.path}`)
    } else {
      log(`${agentId}: vault proposal skipped (${proposal.reason})`)
    }
  }
}

log('Done.')
