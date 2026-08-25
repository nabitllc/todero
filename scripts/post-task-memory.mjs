#!/usr/bin/env node
// post-task-memory.mjs — Records a structured entry after each agent session (TOD-489 repair)
//
// Replaces post-task-memory.sh, which hardcoded one developer's macOS home
// directory as the path to config/scripts/append-agent-memory.py — dead on
// any other machine, and dead on this one too once python3 is not on PATH.
// This version is plain portable Node, needs neither bash nor python3, and
// writes to agent_run_records (a real table — migrations/038_agent_run_records.sql)
// instead of appending prose to workspace-<agent>/self-improving/corrections.md.
//
// Usage:
//   node scripts/post-task-memory.mjs <agent_id> <task_key> <task_title> [exit_status]
//
// Reads the completed task's reviewer/tester/designer notes and rejection
// count straight from the issues table (the same DB the MC API reads —
// TODERO_DIR/TODERO_DB_PROVIDER resolve exactly like the running app), then
// writes one row via lib/memory-loop.ts's writeRunRecord().

import { loadEnvFiles } from './lib/env-file.mjs'
import { importTs, REPO_ROOT } from './lib/ts-import.mjs'
import { requireNodeVersion } from './lib/node-version.mjs'

requireNodeVersion()
process.chdir(REPO_ROOT)
loadEnvFiles(REPO_ROOT)

const [agentId, taskKey, taskTitle, exitStatusArg] = process.argv.slice(2)
if (!agentId || !taskKey || !taskTitle) {
  console.error('Usage: node scripts/post-task-memory.mjs <agent_id> <task_key> <task_title> [exit_status]')
  process.exit(2)
}
const exitStatus = Number.isFinite(Number(exitStatusArg)) ? Number(exitStatusArg) : 0

const dbMod = await importTs('lib/db.ts')
if (!dbMod.ok) {
  console.error(`[post-task-memory] could not load lib/db.ts: ${dbMod.reason}`)
  process.exit(1)
}
const memoryMod = await importTs('lib/memory-loop.ts')
if (!memoryMod.ok) {
  console.error(`[post-task-memory] could not load lib/memory-loop.ts: ${memoryMod.reason}`)
  process.exit(1)
}
const { db } = dbMod.module
const { writeRunRecord } = memoryMod.module

let issue = null
try {
  const { data, error } = await db()
    .from('issues')
    .select('status,reviewer_notes,tester_notes,designer_notes,implementation_notes,rejection_count,last_rejection_reason')
    .eq('task_key', taskKey)
    .limit(1)
  if (error) throw new Error(error.message)
  issue = (data ?? [])[0] ?? null
} catch (err) {
  // Same posture as the original script's `|| echo "[]"` fallback: a lookup
  // failure should not stop the run record from being written — an entry
  // with fewer fields is still more honest than silently skipping it.
  console.warn(`[post-task-memory] issue lookup failed for ${taskKey}: ${err instanceof Error ? err.message : String(err)}`)
}

const rejectionCount = Number(issue?.rejection_count ?? 0)
const failed = exitStatus !== 0 || rejectionCount > 0
const succeeded = !failed && (issue?.status ? /done|completed|closed|in_review/i.test(issue.status) : exitStatus === 0)

const reviewerBits = [issue?.reviewer_notes, issue?.tester_notes, issue?.designer_notes]
  .filter(Boolean)
  .join('\n')

const dbError = await writeRunRecord({
  agentId,
  taskKey,
  taskTitle,
  status: issue?.status ?? null,
  attempted: issue?.implementation_notes ?? null,
  succeeded,
  failed,
  rejectionCount,
  rejectionReason: issue?.last_rejection_reason ?? (exitStatus !== 0 ? `build/runtime error: exit code ${exitStatus}` : null),
  reviewerNotes: reviewerBits || null,
  exitStatus,
})

if (dbError) {
  console.error(`[post-task-memory] write failed for ${agentId}/${taskKey}: ${dbError}`)
  process.exit(1)
}

console.log(`[post-task-memory] recorded ${agentId}/${taskKey} (succeeded=${succeeded}, failed=${failed}, rejections=${rejectionCount}, exit=${exitStatus})`)
