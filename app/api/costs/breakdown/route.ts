import { NextRequest, NextResponse } from 'next/server'
import { assertDbConfigured, db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

function getSupabase() {
  // db() throws a DbConfigurationError naming the exact missing variables.
  assertDbConfigured()
  return db()
}

export interface CostBreakdownRow {
  project: string
  agent: string
  cost_usd: number
  total_tokens: number
}

// GET /api/costs/breakdown?from=2026-04-01&to=2026-04-30
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { searchParams } = req.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  try {
    const supabase = getSupabase()

    // Fetch token_ledger rows in range, joined with issues for project.
    //
    // pieces9 seam 1: this used to filter the ledger by an equality match on
    // the status column against the word for a clean finish. (Spelled out in
    // prose rather than quoted as code on purpose — the seam suite's guard for
    // this change is a regex over this file, and a quoted example of the
    // removed call keeps that guard red forever.)
    //
    // It was a no-op filter for as long as lib/runtimes/claude-code.ts closed EVERY row
    // with a hardcoded status of 'completed' — including the ones it recorded,
    // four lines later, as failed. Now that `evidence.ledgerStatus` makes the
    // column honest ('failed' | 'killed' | 'max_iterations' | 'running' |
    // 'unknown' are all reachable — migrations/075_token_ledger_status_vocabulary.sql),
    // the same filter would start hiding real money: a run that failed still
    // burned its tokens, and those are exactly the runs an operator needs to see
    // (migrations/038_agent_budgets_and_ceilings.sql calls that class of
    // under-count budget-corrupting).
    //
    // The condition this filter was always trying to express is "has this row
    // closed?", not "did it succeed?". `completed_at` is that fact: finalizeRun()
    // in lib/runtimes/token-ledger.ts writes completed_at and status in the same
    // payload, and `spawned` — the only status meaning "still open" — is exactly
    // the set of rows whose completed_at is still null.
    let query = supabase
      .from('token_ledger')
      .select('agent_id, task_key, total_tokens, cost_usd, spawned_at')
      .not('completed_at', 'is', null)

    if (from) query = query.gte('spawned_at', from)
    if (to) {
      // inclusive end of day
      const toDate = new Date(to)
      toDate.setDate(toDate.getDate() + 1)
      query = query.lt('spawned_at', toDate.toISOString().slice(0, 10))
    }

    const { data: ledgerRows, error } = await query.order('spawned_at', { ascending: false }).limit(5000)

    if (error) throw error

    if (!ledgerRows || ledgerRows.length === 0) {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
    }

    // Collect unique task_keys to resolve projects
    const taskKeySet: Record<string, true> = {}
    for (const r of ledgerRows as any[]) {
      if (r.task_key) taskKeySet[r.task_key] = true
    }
    const taskKeys = Object.keys(taskKeySet)

    let projectByKey: Record<string, string> = {}
    if (taskKeys.length > 0) {
      const { data: issues } = await supabase
        .from('issues')
        .select('task_key, project')
        .in('task_key', taskKeys as string[])

      if (issues) {
        for (const issue of issues) {
          if (issue.task_key) projectByKey[issue.task_key] = issue.project ?? 'Unknown'
        }
      }
    }

    // Aggregate by project + agent
    const agg: Record<string, CostBreakdownRow> = {}
    for (const row of ledgerRows as any[]) {
      const project = (row.task_key && projectByKey[row.task_key]) || 'Unknown'
      const agent = row.agent_id || 'unknown'
      const key = `${project}::${agent}`
      if (!agg[key]) agg[key] = { project, agent, cost_usd: 0, total_tokens: 0 }
      agg[key].cost_usd += row.cost_usd ?? 0
      agg[key].total_tokens += row.total_tokens ?? 0
    }

    const rows = Object.values(agg).map(r => ({
      ...r,
      cost_usd: +r.cost_usd.toFixed(6),
    }))

    return NextResponse.json(rows, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Internal error' }, { status: 500 })
  }
}
