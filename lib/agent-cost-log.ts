// TOD-939: Best-effort cost logging for agent completions
// Never blocks route — all errors are swallowed with console.warn

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'

interface CostEntry {
  project: string
  agent: string
  cost_usd: number
  token_count: number
  task_key: string | null
  date: string
}

/**
 * Insert a cost log entry. Best-effort only — catches all errors.
 * Returns true if inserted, false if failed (never throws).
 */
export async function logAgentCost(entry: CostEntry): Promise<boolean> {
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaKey) {
    console.warn('[agent-cost-log] SUPABASE_SERVICE_ROLE_KEY not set — skipping cost log')
    return false
  }

  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/agent_cost_log`, {
      method: 'POST',
      headers: {
        'apikey': supaKey,
        'Authorization': `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(entry),
    })
    if (!res.ok) {
      console.warn(`[agent-cost-log] INSERT failed: ${res.status} ${res.statusText}`)
      return false
    }
    return true
  } catch (err) {
    console.warn('[agent-cost-log] INSERT error:', err)
    return false
  }
}

/**
 * Parse cost/token data from a Claude Code log file.
 * Returns null if parsing fails — best-effort.
 */
export function parseCostFromLog(logContent: string): { cost_usd: number; token_count: number } | null {
  try {
    const costMatch = logContent.match(/total_cost_usd[:\s]+(\d+\.?\d*)/i)
      ?? logContent.match(/cost[:\s]+\$?(\d+\.?\d*)/i)
    const tokenMatch = logContent.match(/total_tokens[:\s]+(\d+)/i)
      ?? logContent.match(/token_count[:\s]+(\d+)/i)
      ?? logContent.match(/tokens[:\s]+(\d+)/i)

    const cost_usd = costMatch ? parseFloat(costMatch[1]) : 0
    const token_count = tokenMatch ? parseInt(tokenMatch[1], 10) : 0

    return { cost_usd, token_count }
  } catch {
    return null
  }
}
