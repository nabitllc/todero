// Throwaway E2E proof script for pieces7/memory-loop. Deleted after use.
// Exercises the REAL production write path: claudeCodeRuntime.spawn() ->
// spawnDetached() -> watchChildExit() -> recordRunOnExit() -> writeRunRecord()
// -> INSERT INTO agent_run_records, against the live ./db.sqlite the running
// dev server reads. CLAUDE_BIN is overridden (the adapter's own documented
// override point) to node.exe so no real Claude credentials/cost are spent —
// nothing here inserts a row directly.

process.env.CLAUDE_BIN = 'C:\\Program Files\\nodejs\\node.exe'

import { claudeCodeRuntime } from './lib/runtimes/claude-code'
import { db } from './lib/db'

async function main() {
  const taskId = process.argv[2]
  if (!taskId) throw new Error('usage: tsx _e2e_memory_proof.mts <issue-id>')

  const logFile = 'C:\\Users\\msaen\\AppData\\Local\\Temp\\claude\\C--Development-Todero\\878287a1-44db-4c12-90cb-4e8a26c2c3ca\\scratchpad\\memory-loop-e2e.log'

  console.log('[proof] spawning via claudeCodeRuntime.spawn() with CLAUDE_BIN=', process.env.CLAUDE_BIN)
  const result = await claudeCodeRuntime.spawn({
    agentId: 'tester',
    workingDir: process.cwd(),
    prompt: 'noop e2e memory-loop-write fixture prompt — not a real task',
    logFile,
    taskId,
    bypassPermissions: true,
  })
  console.log('[proof] spawn result:', JSON.stringify(result))

  if (!result.ok) {
    console.log('[proof] spawn failed — aborting')
    process.exit(1)
  }

  console.log('[proof] waiting 9s for watchChildExit to detect exit and call recordRunOnExit()...')
  await new Promise((resolve) => setTimeout(resolve, 9000))

  const { data, error } = await db()
    .from('agent_run_records')
    .select('*')
    .eq('agent_id', 'tester')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('[proof] agent_run_records (agent_id=tester), error=', error, 'rows=', JSON.stringify(data, null, 2))
  process.exit(0)
}

main().catch((err) => {
  console.error('[proof] FAILED:', err)
  process.exit(1)
})
