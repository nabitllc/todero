// queue-refill: promote refined → open when an agent's open queue is low.
//
// Called by agent-kicker.sh (hourly) and by the heartbeat every 15 min.
// Logic:
//   1. For each agent lane (builder, ops):
//      a. Count how many open issues are assigned to that agent
//      b. If below the QUEUE_MIN threshold, find refined issues assigned to that agent
//      c. Promote up to (QUEUE_MIN - current_open) issues from refined → open
//
// Sets assignee=lane.agent on promote (self-healing: corrects stale assignees from owner-field clobber).
// This does NOT promote po/michael/main assignees. Those are human/orchestrator lanes.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

const MC_API = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/issues`
  : 'http://localhost:3000/api/issues'

// Per-lane queue minimum — if an agent has fewer than this many open issues,
// promote from refined until the threshold is reached (up to PROMOTE_MAX per run).
const QUEUE_MIN = 5
const PROMOTE_MAX = 10  // safety cap: never promote more than this per run per agent

// Lane config: which agents to refill and what type/project filters apply
//
// no-invented-projects-sweep: two more lanes stood here —
//   { agent: 'kemuni-sme',  typeFilter: ['task','bug','ops'], project: 'Kemuni'  }
//   { agent: 'vespera-sme', typeFilter: ['task','bug','ops'], project: 'Vespera' }
// Neither agent nor either project exists. These were not display strings: this
// route WRITES. Each lane counts open issues for its agent and then PATCHes
// real rows refined -> open, setting `assignee: lane.agent` — so a run could
// have stamped a live issue with an assignee no one can dispatch to. It never
// did only because both `.eq('project', ...)` filters match zero rows, and
// because dispatch is held off by lib/dispatch-guard.ts / TODERO_DISPATCH_ENABLED.
// That kill switch is a backstop, not the fix; the fix is that the lanes are gone.
const LANES = [
  { agent: 'builder', typeFilter: ['task', 'bug'],         project: 'Todero' },
  { agent: 'ops',     typeFilter: ['ops'],                 project: null },     // ops = any project
]

export async function POST(_req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const supabase = db()
  const promoted: string[] = []
  const errors: string[] = []

  for (const lane of LANES) {
    try {
      // Count current open issues for this agent
      let openQ = supabase
        .from('issues')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .eq('assignee', lane.agent)
      const { count: openCount, error: openErr } = await openQ
      if (openErr) { errors.push(`${lane.agent} open count: ${openErr.message}`); continue }

      const currentOpen = openCount ?? 0
      if (currentOpen >= QUEUE_MIN) continue  // queue is healthy — nothing to do

      const needed = Math.min(QUEUE_MIN - currentOpen, PROMOTE_MAX)

      // Find refined issues assigned to this agent, filtered by type/project
      let refinedQ = supabase
        .from('issues')
        .select('id,task_key,assignee,type,project')
        .eq('status', 'refined')
        .eq('assignee', lane.agent)
        .in('type', lane.typeFilter)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(needed)

      if (lane.project) {
        refinedQ = refinedQ.eq('project', lane.project)
      }

      const { data: candidates, error: refErr } = await refinedQ
      if (refErr) { errors.push(`${lane.agent} refined query: ${refErr.message}`); continue }
      if (!candidates || candidates.length === 0) continue

      // Promote each via MC API (respects workflow, triggers self-chain, fires Discord)
      for (const issue of candidates) {
        try {
          const res = await fetch(MC_API, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: issue.id,
              status: 'open',
              assignee: lane.agent,
              transitioned_by: 'cron-queue-refill',
            }),
            signal: AbortSignal.timeout(10_000),
          })
          if (res.ok) {
            promoted.push(`${issue.task_key} (${lane.agent})`)
          } else {
            const body = await res.text()
            errors.push(`${issue.task_key}: HTTP ${res.status} — ${body.slice(0, 100)}`)
          }
        } catch (e) {
          errors.push(`${issue.task_key}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      errors.push(`${lane.agent}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    promoted,
    errors,
    summary: `Promoted ${promoted.length} issue(s) from refined to open`,
  })
}

// GET — status check (used by agent-kicker.sh to decide whether to run)
export async function GET(_req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const supabase = db()
  const lanes: Record<string, { open: number; refined: number }> = {}

  for (const lane of LANES) {
    const { count: openCount } = await supabase
      .from('issues').select('id', { count: 'exact', head: true })
      .eq('status', 'open').eq('assignee', lane.agent)
    const { count: refinedCount } = await supabase
      .from('issues').select('id', { count: 'exact', head: true })
      .eq('status', 'refined').eq('assignee', lane.agent)
    lanes[lane.agent] = { open: openCount ?? 0, refined: refinedCount ?? 0 }
  }

  return NextResponse.json({ lanes, queueMin: QUEUE_MIN, ts: new Date().toISOString() })
}
