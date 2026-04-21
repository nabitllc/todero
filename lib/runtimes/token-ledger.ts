// TOD-799: Token ledger middleware + TOD-XXX (2026-04-10) completion hook.
// Records each spawn to the token_ledger Supabase table. Best-effort: silently
// no-ops if the table is missing (warns once then suppresses). Runtime-agnostic:
// Claude Code, Codex, Cursor, OpenAI API adapters all write to the same table.

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY!

let tableMissingWarned = false

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
      const res = await fetch(`${SUPA_URL}/rest/v1/token_ledger`, {
        method: 'POST',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        if (res.status === 404 || res.status === 400) {
          if (!tableMissingWarned) {
            tableMissingWarned = true
            console.warn(
              `[token-ledger] table not found (HTTP ${res.status}). ` +
              `Run migrations/008_token_ledger.sql in Supabase Dashboard SQL editor. ` +
              `Subsequent warnings suppressed.`
            )
          }
          return
        }
        const text = await res.text().catch(() => '')
        console.warn(`[token-ledger] HTTP ${res.status}: ${text.slice(0, 200)}`)
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
      const findUrl = `${SUPA_URL}/rest/v1/token_ledger?log_file=eq.${encodeURIComponent(entry.logFile)}&select=id&order=spawned_at.desc&limit=1`
      const findRes = await fetch(findUrl, {
        headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
      })
      if (!findRes.ok) return
      const rows = await findRes.json() as Array<{ id: string }>
      const row = rows?.[0]
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

      await fetch(`${SUPA_URL}/rest/v1/token_ledger?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': `Bearer ${SUPA_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(updatePayload),
      })
    } catch (err) {
      console.warn(`[token-ledger:recordCompletion] ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}
