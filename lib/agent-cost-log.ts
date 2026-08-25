// TOD-939: Best-effort cost logging for agent completions
// Never blocks route — all errors are swallowed with console.warn


import { db, dbMissingEnv } from '@/lib/db'

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
  const missing = dbMissingEnv()
  if (missing.length > 0) {
    console.warn(`[agent-cost-log] database not configured (missing ${missing.join(', ')}) — skipping cost log`)
    return false
  }

  try {
    const { error } = await db().from('agent_cost_log').insert(entry)
    if (error) {
      console.warn(`[agent-cost-log] INSERT failed: ${error.message}`)
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
