// GET /api/run-agent/trace?runId=<agent_runs.id>
//
// run-agent-locally piece, hard requirement #2: "The run must produce a
// trace, not a log line." Before this route, an operator's only way to see
// what a dispatched agent actually did was `tail` a temp file by hand — no
// endpoint, no UI, and (for the openai-api/Ollama runtime) no per-step
// structure at all, only free text. This resolves one agent_runs row to the
// log file lib/runtimes/openai-api.ts's RUNNER_SCRIPT wrote structured
// `[trace] {...}` lines into, and returns them as a drillable
// run -> steps (model calls, tool calls) -> tokens/cost-per-step structure.
//
// Runtimes that do not emit `[trace]` lines (claude-code, codex, cursor)
// degrade to `steps: []` with the raw log tail attached as `rawLogTail` —
// named as "no structured trace for this runtime yet", never presented as
// an empty run.

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { db, DB_ERROR, type DbError } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { resolveCallerRole, checkRoutePermission } from '@/lib/permission-check'
import { parseOpenAiTrace } from '@/lib/runtimes/openai-api'

const RAW_TAIL_CHARS = 4000

const COLUMNS_WITH_LOG_FILE =
  'id,agent_id,task_id,task_title,status,started_at,finished_at,log_file,tokens_used,cost_usd'
const COLUMNS_WITHOUT_LOG_FILE =
  'id,agent_id,task_id,task_title,status,started_at,finished_at,tokens_used,cost_usd'

/**
 * True when `error` is PostgREST/Postgres telling us `agent_runs.log_file`
 * itself doesn't exist — i.e. this instance has not run
 * migrations/046_agent_runs_log_file.sql (and, per boot-migrate.ts's own
 * comment, a supabase-provider install with no DATABASE_URL never can at
 * boot). Matched by SQLSTATE 42703 first; the message-text fallback covers
 * whatever the sqlite/pg adapters that don't populate `code` say instead
 * (e.g. sqlite: "no such column: log_file"; PostgREST: "column
 * agent_runs.log_file does not exist").
 */
function isMissingLogFileColumn(error: DbError): boolean {
  if (error.code === DB_ERROR.UNDEFINED_COLUMN) return true
  return /log_file/i.test(error.message) && /column|no such/i.test(error.message)
}

export async function GET(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const REQUIRED_PERMISSION = 'agents:read' as const
  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'GET', '/api/run-agent/trace')
    if (!perm.allowed) return NextResponse.json(perm.body, { status: perm.status })
  }

  const runId = req.nextUrl.searchParams.get('runId')
  if (!runId) {
    return NextResponse.json({ error: '?runId=<agent_runs.id> is required' }, { status: 400 })
  }

  let { data, error } = await db()
    .from('agent_runs')
    .select(COLUMNS_WITH_LOG_FILE)
    .eq('id', runId)
    .limit(1)

  // Live Supabase installs with no DATABASE_URL can never self-heal this
  // column at boot (lib/db/boot-migrate.ts's own comment explains why:
  // PostgREST has no DDL grammar). Rather than 500 for every run on such an
  // instance, retry the same lookup without the unmigrated column and say so
  // in the response instead of pretending the run doesn't exist.
  let logFileColumnMissing = false
  if (error && isMissingLogFileColumn(error)) {
    logFileColumnMissing = true
    ;({ data, error } = await db()
      .from('agent_runs')
      .select(COLUMNS_WITHOUT_LOG_FILE)
      .eq('id', runId)
      .limit(1))
  }
  if (error) {
    return NextResponse.json({ error: `run lookup failed: ${error.message}` }, { status: 500 })
  }
  const run = (data ?? [])[0] as {
    id: string; agent_id: string; task_id: string | null; task_title: string | null
    status: string | null; started_at: string | null; finished_at: string | null
    log_file?: string | null; tokens_used: number | null; cost_usd: number | null
  } | undefined
  if (!run) {
    return NextResponse.json({ error: `no agent_runs row with id ${runId}` }, { status: 404 })
  }

  if (logFileColumnMissing) {
    return NextResponse.json({
      run: { ...run, log_file: null },
      steps: [],
      totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, toolCalls: 0 },
      note: 'log_file column not migrated — run `npm run db:migrate` with DATABASE_URL',
    })
  }

  if (!run.log_file) {
    return NextResponse.json({
      run,
      steps: [],
      totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, toolCalls: 0 },
      note: 'no log_file recorded for this run — it predates migrations/046_agent_runs_log_file.sql, or the spawn never persisted one',
    })
  }
  if (!existsSync(run.log_file)) {
    return NextResponse.json({
      run,
      steps: [],
      totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, toolCalls: 0 },
      note: `log file no longer on disk: ${run.log_file}`,
    })
  }

  // parseOpenAiTrace reads whatever model the ledger says for cost — the run
  // row itself doesn't carry a model id, so fall back to '' (estimateModelRateUsd
  // returns 0 for an unrecognized id, which is honest: no cloud rate to charge
  // for a runtime this parser cannot identify).
  const parsed = parseOpenAiTrace(run.log_file, '')
  if (parsed.steps.length > 0) {
    return NextResponse.json({ run, steps: parsed.steps, totals: parsed.totals })
  }

  // No structured [trace] lines — either this runtime doesn't emit them yet,
  // or the process never got far enough to write any. Say so, with the raw
  // tail attached so the operator isn't left with nothing.
  let rawLogTail = ''
  try {
    const full = readFileSync(run.log_file, 'utf8')
    rawLogTail = full.slice(-RAW_TAIL_CHARS)
  } catch { /* file existed a moment ago; best-effort */ }

  return NextResponse.json({
    run,
    steps: [],
    totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, toolCalls: 0 },
    note: 'no structured [trace] lines in this log — this runtime does not emit per-step trace yet (only openai-api does)',
    rawLogTail,
  })
}
