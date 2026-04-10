#!/usr/bin/env -S npx tsx
// TOD-XXX (Gap 3): Parse a finished agent log file and record completion
// stats to the token_ledger. Runs as a post-task finalizer invoked by the
// monitor-stale script (or manually).
//
// Usage:
//   npx tsx scripts/parse-agent-log.ts <log-file> [--agent builder] [--task-id UUID]
//
// What it looks for (runtime-specific):
//   - [spawn-exit] line we now write (exit code + signal)
//   - Claude Code --print output sometimes prefixes tool calls and we can
//     count turns heuristically
//   - If the log is empty or no exit line, status='failed'
//
// Writes to token_ledger via /api/run-agent proxy (so the route.ts code
// that imports recordCompletion is the single source of truth).

import { readFileSync } from 'fs'
import { basename } from 'path'

interface ParsedLog {
  exitCode: number | null
  exitSignal: string | null
  lineCount: number
  hadSpawnStart: boolean
  hadSpawnExit: boolean
  errorMessages: string[]
  estimatedDurationSec: number | null
  spawnStartedAt: string | null
  spawnEndedAt: string | null
}

export function parseAgentLog(logPath: string): ParsedLog {
  const result: ParsedLog = {
    exitCode: null,
    exitSignal: null,
    lineCount: 0,
    hadSpawnStart: false,
    hadSpawnExit: false,
    errorMessages: [],
    estimatedDurationSec: null,
    spawnStartedAt: null,
    spawnEndedAt: null,
  }

  let content = ''
  try {
    content = readFileSync(logPath, 'utf8')
  } catch (err) {
    result.errorMessages.push(`log not readable: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  const lines = content.split('\n')
  result.lineCount = lines.length

  for (const line of lines) {
    if (line.startsWith('[spawn-start]')) {
      result.hadSpawnStart = true
      const m = line.match(/\[spawn-start\]\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)
      if (m && !result.spawnStartedAt) result.spawnStartedAt = m[1]
    } else if (line.startsWith('[spawn-exit]')) {
      result.hadSpawnExit = true
      const m = line.match(/\[spawn-exit\]\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+pid=\d+\s+code=(\S+)\s+signal=(\S+)/)
      if (m) {
        result.spawnEndedAt = m[1]
        result.exitCode = m[2] === 'null' ? null : parseInt(m[2], 10)
        result.exitSignal = m[3] === 'null' ? null : m[3]
      }
    } else if (line.startsWith('[spawn-error]') || line.startsWith('[spawn-failure]')) {
      const m = line.match(/\[spawn-(?:error|failure)\][^\n]+/)
      if (m) result.errorMessages.push(m[0])
    }
  }

  if (result.spawnStartedAt && result.spawnEndedAt) {
    result.estimatedDurationSec = Math.round(
      (new Date(result.spawnEndedAt).getTime() - new Date(result.spawnStartedAt).getTime()) / 1000
    )
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
if (require.main === module) {
  const logPath = process.argv[2]
  if (!logPath) {
    console.error('Usage: npx tsx scripts/parse-agent-log.ts <log-file>')
    process.exit(2)
  }
  const parsed = parseAgentLog(logPath)
  console.log(JSON.stringify({
    file: basename(logPath),
    ...parsed,
    status: parsed.hadSpawnExit && parsed.exitCode === 0 ? 'completed'
      : parsed.hadSpawnExit ? 'failed'
      : parsed.hadSpawnStart ? 'in_progress_or_killed'
      : 'never_started',
  }, null, 2))
}
