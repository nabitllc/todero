// app/api/agents/[id]/budget/route.ts — TOD-2381 (agent-budget-stop)
//
// GET  — this agent's ceilings and real spend-to-date, read from the same
//        agent_runs / token_ledger rows the dispatch path and the heartbeat
//        ceiling check both read. Never an estimate.
// PATCH — set one or more ceilings for this agent (limit_usd, max_concurrent_
//        runs, max_run_ms, no_progress_heartbeats, max_runs_per_period,
//        period). This is the operator's lever — it is how a ceiling gets
//        tightened without a code change, and how the "set a deliberately
//        tiny limit and show it refuse" demonstration is done for real.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { getAgentBudget, setAgentBudget, getSpendUsd, RUN_PERIOD_MS } from '@/lib/agent-budget'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = params.id
  const budget = await getAgentBudget(agentId)

  const [{ data: runningForAgent }, { data: runningTotal }, { data: runsInPeriod }] = await Promise.all([
    db().from('agent_runs').select('id').eq('agent_id', agentId).eq('status', 'running'),
    db().from('agent_runs').select('id').eq('status', 'running'),
    db().from('token_ledger').select('id').eq('agent_id', agentId).gte('spawned_at', new Date(Date.now() - RUN_PERIOD_MS).toISOString()),
  ])

  const periodStart = budget.period === 'monthly'
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    : budget.period === 'run'
      ? new Date(Date.now() - RUN_PERIOD_MS).toISOString()
      : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()
  const spendUsd = await getSpendUsd(agentId, periodStart)

  return NextResponse.json({
    agentId,
    budget: {
      period: budget.period,
      limitUsd: budget.limitUsd,
      maxConcurrentPerAgent: budget.maxConcurrentPerAgent,
      maxRunMs: budget.maxRunMs,
      noProgressHeartbeats: budget.noProgressHeartbeats,
      maxRunsPerPeriod: budget.maxRunsPerPeriod,
      source: budget.source,
    },
    spend: {
      runningNow: (runningForAgent ?? []).length,
      runningTotalAllAgents: (runningTotal ?? []).length,
      runsInLast24h: (runsInPeriod ?? []).length,
      spendUsdThisPeriod: spendUsd,
      overConcurrency: (runningForAgent ?? []).length >= budget.maxConcurrentPerAgent,
      overRunCount: (runsInPeriod ?? []).length >= budget.maxRunsPerPeriod,
      overDollarBudget: budget.limitUsd != null && spendUsd >= budget.limitUsd,
    },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = params.id
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const patch: Parameters<typeof setAgentBudget>[1] = {}
  if ('period' in body) patch.period = body.period as 'run' | 'daily' | 'monthly'
  if ('limitUsd' in body) patch.limitUsd = body.limitUsd === null ? null : Number(body.limitUsd)
  if ('maxConcurrentPerAgent' in body) patch.maxConcurrentPerAgent = Number(body.maxConcurrentPerAgent)
  if ('maxRunMs' in body) patch.maxRunMs = Number(body.maxRunMs)
  if ('noProgressHeartbeats' in body) patch.noProgressHeartbeats = Number(body.noProgressHeartbeats)
  if ('maxRunsPerPeriod' in body) patch.maxRunsPerPeriod = Number(body.maxRunsPerPeriod)

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update — send at least one of period, limitUsd, maxConcurrentPerAgent, maxRunMs, noProgressHeartbeats, maxRunsPerPeriod' }, { status: 400 })
  }

  const result = await setAgentBudget(agentId, patch)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  const budget = await getAgentBudget(agentId)
  return NextResponse.json({ ok: true, agentId, budget })
}
