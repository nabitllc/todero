// TOD-799: Token ledger middleware — records each spawn to the token_ledger
// Supabase table. Best-effort: if the table doesn't exist yet (migration not
// applied), logs a single warning and silently no-ops subsequent calls.
// Runtime-agnostic: Claude Code, Codex, Cursor, OpenAI API adapters all write
// to the same table via this helper.

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

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

/**
 * Record a spawn event. Fire-and-forget — never blocks the caller.
 * If the table doesn't exist yet, silently no-ops after the first warning.
 */
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
