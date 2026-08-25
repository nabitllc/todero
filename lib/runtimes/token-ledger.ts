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
  /**
   * When the caller knows which issue this run belonged to, also closes any
   * still-`running` `agent_runs` row for it. Normal completions already close
   * that row when the issue's status changes (app/api/issues/route.ts, "Close
   * agent_runs on status change"); this is the safety net for a process that
   * exited WITHOUT ever moving the issue — otherwise that row (and the
   * per-agent concurrency ceiling reading it) would think the agent was still
   * running forever.
   */
  taskId?: string | null
}

/**
 * TOD-2381 (agent-budget-stop): the ledger's closing function.
 *
 * Before this piece, this function existed under the name `recordCompletion`
 * and NOTHING called it — every one of 66,879 `token_ledger` rows sat at
 * `status='spawned'` forever, `cost_usd` always NULL, so a budget reading this
 * table saw zero spend on any agent no matter how much ran. It is now wired
 * into the real run lifecycle from `lib/runtimes/claude-code.ts`'s
 * process-exit watcher (`watchChildExit`'s `onExit` callback) — every spawn
 * this repo launches closes its own row when the process actually exits.
 */
export function finalizeRun(entry: CompletionEntry): void {
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

      if (entry.taskId) {
        await db()
          .from('agent_runs')
          .update({ status: entry.status, finished_at: new Date().toISOString() })
          .eq('task_id', entry.taskId)
          .eq('status', 'running')
      }
    } catch (err) {
      console.warn(`[token-ledger:finalizeRun] ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}

/** @deprecated use {@link finalizeRun} — kept only so any stale caller still compiles. */
export const recordCompletion = finalizeRun
