// /api/cron/watchdog — Vercel Cron target (every 30 min)
//
// When deployed to Vercel, this route replaces the Mac Mini LaunchAgent
// (work.nabit.agent-kicker → pipeline-watchdog.sh).
//
// While Mac Mini is the agent runner, this route delegates to it via
// POST /api/run-agent for each idle lane. On Vercel serverless the
// claude-code runtime's spawn() is a no-op (no local CLI), so the
// run-agent route handles that gracefully.
//
// TODO (TOD-XXX): implement full JS watchdog logic here so this works
// standalone without Mac Mini. Until then, Vercel crons are additive
// (Mac Mini watchdog fires first; Vercel cron is a safety net).

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

// Vercel cron authentication — reject unauthenticated external callers
function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get('authorization')
  // Vercel injects this header on cron invocations
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true
  // Also allow internal calls (same Vercel project, localhost)
  const host = req.headers.get('host') || ''
  return host.includes('localhost') || host.includes('.vercel.app')
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: issues, error } = await db
    .from('issues')
    .select('id,task_key,status,assignee,started_at,updated_at,type,is_blocked,acceptance_criteria,tester_status,designer_status')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const STALE_MS = 30 * 60 * 1000 // 30 min

  // Simple lane check: find lanes that are idle with eligible work
  const lanes = [
    { agent: 'builder',  pickup: 'open',        working: 'in_progress' },
    { agent: 'tester',   pickup: 'code_review',  working: 'code_review' },
    { agent: 'designer', pickup: 'code_review',  working: 'code_review' },
    { agent: 'po',       pickup: 'backlog',      working: 'refined'     },
    { agent: 'deployer', pickup: 'approved',     working: 'approved'    },
    { agent: 'auditor',  pickup: 'released',     working: 'released'    },
  ]

  const kicked: string[] = []
  const cleared: string[] = []

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  for (const lane of lanes) {
    const inflight = issues?.filter(i =>
      i.status === lane.working &&
      i.started_at &&
      (lane.agent === 'tester' || lane.agent === 'designer' || i.assignee === lane.agent)
    ) ?? []

    // Clear stale claims
    for (const issue of inflight) {
      const ageMs = now - new Date(issue.started_at).getTime()
      if (ageMs > STALE_MS) {
        await db.from('issues').update({
          started_at: null,
          transitioned_by: 'cron-watchdog',
        }).eq('id', issue.id)
        cleared.push(issue.task_key)
      }
    }

    const activeCount = inflight.filter(i => {
      const ageMs = now - new Date(i.started_at).getTime()
      return ageMs <= STALE_MS
    }).length

    if (activeCount > 0) continue // agent is working, leave it

    // Check for eligible work
    const eligible = issues?.some(i => {
      if (i.status !== lane.pickup) return false
      if (i.is_blocked) return false
      if (lane.agent !== 'tester' && lane.agent !== 'designer' && i.assignee !== lane.agent) return false
      if (lane.agent === 'tester' && i.tester_status !== 'pending') return false
      if (lane.agent === 'designer' && i.designer_status !== 'pending') return false
      return true
    }) ?? false

    if (eligible) {
      // Kick the agent via run-agent API
      try {
        const res = await fetch(`${appUrl}/api/run-agent?agent=${lane.agent}`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        })
        const body = await res.json()
        if (body.ok) kicked.push(`${lane.agent}:${body.task?.taskKey ?? '?'}`)
      } catch (e) {
        console.warn(`[cron/watchdog] kick ${lane.agent} failed:`, e)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    cleared,
    kicked,
  })
}
