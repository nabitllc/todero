import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('costs/breakdown: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  return createClient(url, key)
}

export interface CostBreakdownRow {
  project: string
  agent: string
  cost_usd: number
  total_tokens: number
}

// GET /api/costs/breakdown?from=2026-04-01&to=2026-04-30
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  try {
    const supabase = getSupabase()

    // Fetch token_ledger rows in range, joined with issues for project
    let query = supabase
      .from('token_ledger')
      .select('agent_id, task_key, total_tokens, cost_usd, spawned_at')
      .eq('status', 'completed')

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
