// TOD-799: Token ledger middleware + TOD-XXX (2026-04-10) completion hook.
// Records each spawn to the token_ledger table through the database seam.
// Best-effort: silently no-ops if the table is missing (warns once then
// suppresses). Runtime-agnostic: Claude Code, Codex, Cursor and OpenAI API
// adapters all write to the same table.

import { db, type DbError } from '@/lib/db'

let tableMissingWarned = false

/** Postgres/PostgREST codes that mean "this table was never migrated". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

function isMissingTable(error: DbError): boolean {
  return (
    (error.code != null && MISSING_TABLE_CODES.has(error.code))
    || /does not exist|could not find the table/i.test(error.message)
  )
}

export interface TokenLedgerEntry {
  agentId: string
  taskId?: string | null
  taskKey?: string | null
  runtime: string
  model?: string | null
  promptBytes: number
  logFile: string
  metadata?: Record<string, unknown> | null
}

export function recordSpawn(entry: TokenLedgerEntry): void {
  void (async () => {
    try {
      const body = {
        agent_id: entry.agentId,
        task_id: entry.taskId ?? null,
        task_key: entry.taskKey ?? null,
        runtime: entry.runtime,
        model: entry.model ?? null,
        prompt_bytes: entry.promptBytes,
        log_file: entry.logFile,
        metadata: entry.metadata ?? null,
        status: 'spawned',
      }
      const { error } = await db().from('token_ledger').insert(body)
      if (error) {
        if (isMissingTable(error)) {
          if (!tableMissingWarned) {
            tableMissingWarned = true
            console.warn(
              `[token-ledger] table not found (${error.code ?? 'no code'}). ` +
              `Run migrations/008_token_ledger.sql against the database. ` +
              `Subsequent warnings suppressed.`
            )
          }
          return
        }
        console.warn(`[token-ledger] insert failed: ${error.message.slice(0, 200)}`)
      }
    } catch (err) {
      console.warn(
        `[token-ledger] ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })()
}

// ── TOD-XXX (Gap 3): completion hook ──────────────────────────────────────
//
// Called by the post-spawn log parser once the agent's claude process has exited.
// Updates the token_ledger row with completion stats. Works with the log-sentinel
// format written by lib/runtimes/claude-code.ts (which writes [spawn-start] and
// [spawn-exit] lines). Codex and Cursor adapters will need their own parsers
// when they're active.

export interface CompletionEntry {
  logFile: string
  status: 'completed' | 'failed' | 'killed'
  exitCode?: number | null
  exitSignal?: string | null
  durationSec?: number | null
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  error?: string
}

export function recordCompletion(entry: CompletionEntry): void {
  void (async () => {
    try {
      // Find the token_ledger row for this log file
      const { data, error: findError } = await db()
        .from('token_ledger')
        .select('id')
        .eq('log_file', entry.logFile)
        .order('spawned_at', { ascending: false })
        .limit(1)
      if (findError) return
      const row = ((data ?? []) as Array<{ id: string }>)[0]
      if (!row) return

      const updatePayload: Record<string, unknown> = {
        completed_at: new Date().toISOString(),
        status: entry.status,
      }
      if (entry.inputTokens != null) updatePayload.input_tokens = entry.inputTokens
      if (entry.outputTokens != null) updatePayload.output_tokens = entry.outputTokens
      if (entry.costUsd != null) updatePayload.cost_usd = entry.costUsd
      // Merge exit info into metadata
      if (entry.exitCode != null || entry.exitSignal != null || entry.error) {
        updatePayload.metadata = {
          exit_code: entry.exitCode ?? null,
          exit_signal: entry.exitSignal ?? null,
          duration_sec: entry.durationSec ?? null,
          error: entry.error ?? null,
        }
      }

      await db().from('token_ledger').update(updatePayload).eq('id', row.id)
    } catch (err) {
      console.warn(`[token-ledger:recordCompletion] ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}
