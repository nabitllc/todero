// TOD-799: Token ledger middleware + TOD-XXX (2026-04-10) completion hook.
// Records each spawn to the token_ledger table through the database seam.
// Best-effort: silently no-ops if the table is missing (warns once then
// suppresses). Runtime-agnostic: Claude Code, Codex, Cursor and OpenAI API
// adapters all write to the same table.

import { db, DB_ERROR, type DbError } from '@/lib/db'

let tableMissingWarned = false

/** Postgres/PostgREST codes that mean "this table was never migrated". */
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

function isMissingTable(error: DbError): boolean {
  return (
    (error.code != null && MISSING_TABLE_CODES.has(error.code))
    || /does not exist|could not find the table/i.test(error.message)
  )
}

// evidence-based-verification (round 3): the four upstream-correlation
// columns migrations/054_ledger_upstream_correlation.sql adds
// (provider_response_id, provider_model, upstream_started_at,
// upstream_finished_at). Same degrade pattern as
// `isMissingLogFileColumn` in app/api/run-agent/trace/route.ts, copied here
// because the failure mode is worse for THIS write: PostgREST rejects the
// ENTIRE update when even one column in the payload is unrecognized (proven
// live — PATCH /api/db/inbox with a bogus column returns HTTP 400
// PGRST204), so on an unmigrated Supabase install every finalizeRun() call
// that tries to set these four columns was silently losing completed_at,
// status, input_tokens, output_tokens and cost_usd too. Matched by SQLSTATE
// 42703 (a direct-Postgres install, e.g. the `postgres` adapter) or PGRST204
// (PostgREST's "column not in schema cache" — the `supabase` adapter, which
// is this repo's actual default per lib/db/adapters.ts) naming one of the
// four columns in the error message.
const CORRELATION_COLUMNS = [
  'provider_response_id',
  'provider_model',
  'upstream_started_at',
  'upstream_finished_at',
] as const

function isMissingCorrelationColumn(error: DbError): boolean {
  if (error.code !== DB_ERROR.UNDEFINED_COLUMN && error.code !== 'PGRST204') return false
  return CORRELATION_COLUMNS.some((col) => error.message.includes(col))
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
  // 'max_iterations' | 'running' | 'unknown' are openai-api.ts's ParsedTrace
  // statuses, passed through as-is (see lib/runtimes/openai-api.ts's
  // finalizeRun call) rather than collapsed to 'completed' — a run that hit
  // the iteration cap or never wrote a run_end trace line is not the same
  // thing as one that finished, and this column is what the trace endpoint
  // and the agent_runs safety-net update both report back as ground truth.
  status: 'completed' | 'failed' | 'killed' | 'max_iterations' | 'running' | 'unknown'
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
  // evidence-based-verification (round 2): upstream correlation, populated
  // only by lib/runtimes/openai-api.ts. This is what lets
  // scripts/evidence/verify.mjs prove a specific token_ledger row — not just
  // "some row" — actually caused a specific line in Ollama's own log:
  // providerResponseId/providerModel come straight off the chat-completions
  // response body, upstream{Started,Finished}At bracket exactly the fetch
  // that produced it (see RUNNER_SCRIPT's callStart/callEnd). claude-code,
  // codex and cursor never set these — their rows stay null forever, which
  // is intentional: a row this seam never populated must never be treated
  // as if an upstream LLM endpoint produced it.
  providerResponseId?: string | null
  providerModel?: string | null
  upstreamStartedAt?: string | null
  upstreamFinishedAt?: string | null
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
      if (entry.providerResponseId != null) updatePayload.provider_response_id = entry.providerResponseId
      if (entry.providerModel != null) updatePayload.provider_model = entry.providerModel
      if (entry.upstreamStartedAt != null) updatePayload.upstream_started_at = entry.upstreamStartedAt
      if (entry.upstreamFinishedAt != null) updatePayload.upstream_finished_at = entry.upstreamFinishedAt
      // Merge exit info into metadata
      if (entry.exitCode != null || entry.exitSignal != null || entry.error) {
        updatePayload.metadata = {
          exit_code: entry.exitCode ?? null,
          exit_signal: entry.exitSignal ?? null,
          duration_sec: entry.durationSec ?? null,
          error: entry.error ?? null,
        }
      }

      // evidence-based-verification (round 3): this used to fire-and-forget
      // (`await ...update(...)` with the result discarded) — no error check,
      // no log. On the owner's actual Supabase install, migration 054 has
      // never applied (PostgREST has no DDL grammar — see
      // lib/db/boot-migrate.ts's own comment), so this update always errored
      // and PostgREST's all-or-nothing rejection meant completed_at, status,
      // input_tokens, output_tokens and cost_usd were being silently lost on
      // EVERY openai-api run, forever, with nothing anywhere saying so.
      let { error: updateError } = await db().from('token_ledger').update(updatePayload).eq('id', row.id)

      if (updateError && isMissingCorrelationColumn(updateError)) {
        // Retry the write with all four correlation columns dropped — not
        // just the one named in the error — because PostgREST rejects the
        // WHOLE update when any one column in the payload is unrecognized,
        // so a partial drop would just fail again on the next column.
        const {
          provider_response_id: _prid,
          provider_model: _pmodel,
          upstream_started_at: _ustart,
          upstream_finished_at: _ufinish,
          ...withoutCorrelation
        } = updatePayload
        withoutCorrelation.metadata = {
          ...(typeof withoutCorrelation.metadata === 'object' && withoutCorrelation.metadata !== null
            ? (withoutCorrelation.metadata as Record<string, unknown>)
            : {}),
          upstream_correlation_unavailable: 'columns not migrated: run npm run db:migrate with DATABASE_URL',
        }
        const retry = await db().from('token_ledger').update(withoutCorrelation).eq('id', row.id)
        updateError = retry.error
        if (updateError) {
          console.warn(
            `[token-ledger:finalizeRun] update failed even after dropping correlation columns: ${updateError.message.slice(0, 200)}`,
          )
        }
      } else if (updateError) {
        console.warn(`[token-ledger:finalizeRun] update failed: ${updateError.message.slice(0, 200)}`)
      }

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
