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
// Design: two targeted queries, not a full table scan.
//
// Query 1 — stale claims only:
//   status=in.(all working statuses) AND started_at < (now - 30min)
//   Returns at most a handful of rows in a healthy system.
//
// Query 2 — per-lane eligibility: just call run-agent.
//   run-agent already does the proper DoR/blocked/WIP check.
//   We call it; if nothing is eligible it returns "No eligible issues" and we skip.
//   This avoids duplicating eligibility logic here and cuts egress vs scanning 2000+ rows.

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

// All statuses where an agent can hold a "started" claim
const WORKING_STATUSES = ['in_progress', 'code_review', 'approved', 'released', 'refined']

// All agent lanes: just the agent id (eligibility is delegated to run-agent)
const AGENT_LANES = ['builder', 'ops', 'scout', 'tester', 'designer', 'po', 'deployer', 'auditor']

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const now = Date.now()
  const STALE_MS = 30 * 60 * 1000 // 30 min
  const staleCutoff = new Date(now - STALE_MS).toISOString()

  // ── Query 1: stale claims only ───────────────────────────────────────────────
  // Fetch ONLY issues that are in a working status AND started_at is old.
  // In a healthy system this returns 0 rows. Avoids full table scan.
  const { data: staleIssues, error: staleErr } = await db
    .from('issues')
    .select('id,task_key,assignee,status,started_at')
    .in('status', WORKING_STATUSES)
    .not('started_at', 'is', null)
    .lt('started_at', staleCutoff)

  if (staleErr) {
    return NextResponse.json({ error: staleErr.message }, { status: 500 })
  }

  const cleared: string[] = []

  for (const issue of staleIssues ?? []) {
    await db.from('issues').update({
      started_at: null,
      worked_by: null,
      transitioned_by: 'cron-watchdog',
    }).eq('id', issue.id)
    cleared.push(issue.task_key)
    console.log(`[watchdog] cleared stale claim: ${issue.task_key} (${issue.assignee}, ${issue.status}, started ${issue.started_at})`)
  }

  // ── Query 2: kick idle agents ─────────────────────────────────────────────
  // Delegate to run-agent for each lane. run-agent handles:
  //   - WIP limit check (agent already busy? returns 200 with message, not an error)
  //   - DoR gate (description + AC present)
  //   - Blocked-item skip
  //   - Priority sort
  // If WIP limit is reached or no eligible work, run-agent returns a non-ok body — we skip.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const kicked: string[] = []

  await Promise.all(AGENT_LANES.map(async (agent) => {
    try {
      const res = await fetch(`${appUrl}/api/run-agent?agent=${agent}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      })
      const body = await res.json() as { ok?: boolean; task?: { taskKey?: string }; wip?: number; message?: string }
      if (body.ok && body.task?.taskKey) {
        kicked.push(`${agent}:${body.task.taskKey}`)
      }
      // WIP-limit and "no eligible issues" responses are silent no-ops (correct behavior)
    } catch (e) {
      console.warn(`[watchdog] kick ${agent} failed:`, e)
    }
  }))

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    cleared,
    kicked,
  })
}
