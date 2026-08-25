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
<<<<<<< Updated upstream
import { getAgentBudget, setAgentBudget, getSpendUsd, getCeilingStatus, RUN_PERIOD_MS, STALE_RUN_CUTOFF_MS } from '@/lib/agent-budget'
=======
import { getAgentBudget, setAgentBudget, getSpendUsd, RUN_PERIOD_MS, STALE_RUN_CUTOFF_MS } from '@/lib/agent-budget'
>>>>>>> Stashed changes

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = params.id
  const budget = await getAgentBudget(agentId)

<<<<<<< Updated upstream
  // Same staleness filter and the same `count: 'exact'` mode
  // checkDispatchCeilings (lib/agent-budget.ts) uses, not `.select('id')`
  // with the array length as a stand-in count. Those diverged two ways: (1)
  // an unfiltered `.select('id')` counts every agent_runs row ever stuck at
  // status='running' (67,592+ on this host — see lib/agent-budget.ts's own
  // comment on the same bug, one table over) as "running now", which made
  // `overConcurrency` true for agents the dispatch path would happily accept;
  // (2) `count: 'exact'` asks the adapter for a real COUNT(*) instead of
  // materializing rows, so this panel does not silently cap at whatever page
  // size the adapter defaults to (PostgREST's default is 1000) the way a bare
  // `.select('id')` would on a host with more matching rows than that.
  const staleCutoff = new Date(Date.now() - STALE_RUN_CUTOFF_MS).toISOString()
  const [{ count: runningNow }, { count: runningTotalAllAgents }, { count: runsInLast24h }] = await Promise.all([
=======
  // Exact counts (`count: 'exact', head: true`), not `.select('id')` read
  // into an array: an unbounded select silently caps at PostgREST's 1000-row
  // page, so on this host — 67,591 agent_runs rows stuck at status='running'
  // — every `.length` here used to report exactly 1000, a page size
  // masquerading as a measurement, not the true count. And the SAME
  // `STALE_RUN_CUTOFF_MS` dead-row filter checkDispatchCeilings/
  // checkInFlightCeilings apply, so this route's overConcurrency verdict
  // reads the identical rows the enforcement path counts — it cannot report
  // a ceiling breach (or clearance) the code that actually stops runs
  // disagrees with.
  const staleCutoff = new Date(Date.now() - STALE_RUN_CUTOFF_MS).toISOString()
  const [
    { count: runningForAgent },
    { count: runningTotal },
    { count: runsInPeriod },
  ] = await Promise.all([
>>>>>>> Stashed changes
    db().from('agent_runs').select('id', { count: 'exact', head: true }).eq('agent_id', agentId).eq('status', 'running').gte('started_at', staleCutoff),
    db().from('agent_runs').select('id', { count: 'exact', head: true }).eq('status', 'running').gte('started_at', staleCutoff),
    db().from('token_ledger').select('id', { count: 'exact', head: true }).eq('agent_id', agentId).gte('spawned_at', new Date(Date.now() - RUN_PERIOD_MS).toISOString()),
  ])

  const periodStart = budget.period === 'monthly'
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    : budget.period === 'run'
      ? new Date(Date.now() - RUN_PERIOD_MS).toISOString()
      : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString()

  // getSpendUsd now throws on a genuine read error instead of returning 0
  // (lib/agent-budget.ts) — surfaced here as `spendError` rather than a
  // spend that reads as real zero.
  let spendUsd: number | null = null
  let spendError: string | null = null
  try {
    spendUsd = await getSpendUsd(agentId, periodStart)
  } catch (err) {
    spendError = err instanceof Error ? err.message : String(err)
  }

  // Same evaluation checkDispatchCeilings runs before a real run starts,
  // read-only here (no inbox write — see getCeilingStatus's doc comment).
  // This is the "over ceiling — <reason>" badge the roster and this panel
  // both show, computed once instead of re-derived per surface from raw
  // spend/run numbers that could drift out of sync with the enforcement path.
  const ceiling = await getCeilingStatus(agentId)

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
<<<<<<< Updated upstream
      runningNow: runningNow ?? 0,
      runningTotalAllAgents: runningTotalAllAgents ?? 0,
      runsInLast24h: runsInLast24h ?? 0,
      spendUsdThisPeriod: spendUsd,
      spendError,
      overConcurrency: (runningNow ?? 0) >= budget.maxConcurrentPerAgent,
      overRunCount: (runsInLast24h ?? 0) >= budget.maxRunsPerPeriod,
      overDollarBudget: budget.limitUsd != null && spendUsd != null && spendUsd >= budget.limitUsd,
=======
      runningNow: runningForAgent ?? 0,
      runningTotalAllAgents: runningTotal ?? 0,
      runsInLast24h: runsInPeriod ?? 0,
      spendUsdThisPeriod: spendUsd,
      overConcurrency: (runningForAgent ?? 0) >= budget.maxConcurrentPerAgent,
      overRunCount: (runsInPeriod ?? 0) >= budget.maxRunsPerPeriod,
      overDollarBudget: budget.limitUsd != null && spendUsd >= budget.limitUsd,
>>>>>>> Stashed changes
    },
    overCeiling: ceiling.allowed ? null : { ceiling: ceiling.ceiling, reason: ceiling.reason, detail: ceiling.detail },
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
