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

  // Cutoffs — tiered by liveness signal quality:
  //   HEARTBEAT: agent writes heartbeat_at every ~5 min. If 10 min stale → dead.
  //   NO_COMMIT:  started_at old + no commit_sha → agent died before any work. 20 min.
  //   FALLBACK:   started_at old, has commit_sha → agent did some work, be generous. 30 min.
  //   GHOST:      in_progress with null started_at → 30 min since updated_at.
  const HEARTBEAT_MS  = 10 * 60 * 1000
  const NO_COMMIT_MS  = 20 * 60 * 1000
  const FALLBACK_MS   = 30 * 60 * 1000

  const heartbeatCutoff = new Date(now - HEARTBEAT_MS).toISOString()
  const noCommitCutoff  = new Date(now - NO_COMMIT_MS).toISOString()
  const fallbackCutoff  = new Date(now - FALLBACK_MS).toISOString()

  const cleared: string[] = []

  // ── Query 1a: dead by heartbeat ──────────────────────────────────────────
  // Agent was writing heartbeats but stopped > 10 min ago → process is dead.
  const { data: deadHeartbeat, error: hbErr } = await db
    .from('issues')
    .select('id,task_key,assignee,status,started_at,heartbeat_at,commit_sha')
    .in('status', WORKING_STATUSES)
    .not('heartbeat_at', 'is', null)
    .lt('heartbeat_at', heartbeatCutoff)

  if (hbErr) return NextResponse.json({ error: hbErr.message }, { status: 500 })

  for (const issue of deadHeartbeat ?? []) {
    await db.from('issues').update({
      status: 'open',
      started_at: null,
      heartbeat_at: null,
      worked_by: null,
      transitioned_by: 'cron-watchdog',
    }).eq('id', issue.id)
    cleared.push(issue.task_key)
    console.log(`[watchdog] dead heartbeat → open: ${issue.task_key} (${issue.assignee}, last hb ${issue.heartbeat_at})`)
  }

  // ── Query 1b: stale — no heartbeat, no commit_sha (20 min) ───────────────
  // Agent claimed the issue but never wrote a heartbeat or committed.
  // Almost certainly spawned and died immediately.
  const { data: staleNoCommit, error: ncErr } = await db
    .from('issues')
    .select('id,task_key,assignee,status,started_at')
    .in('status', WORKING_STATUSES)
    .is('heartbeat_at', null)
    .is('commit_sha', null)
    .not('started_at', 'is', null)
    .lt('started_at', noCommitCutoff)

  if (ncErr) return NextResponse.json({ error: ncErr.message }, { status: 500 })

  for (const issue of staleNoCommit ?? []) {
    await db.from('issues').update({
      status: 'open',
      started_at: null,
      worked_by: null,
      transitioned_by: 'cron-watchdog',
    }).eq('id', issue.id)
    cleared.push(issue.task_key)
    console.log(`[watchdog] stale no-commit → open: ${issue.task_key} (${issue.assignee}, started ${issue.started_at})`)
  }

  // ── Query 1c: stale — has commit_sha but no heartbeat (30 min) ───────────
  // Agent did some work (commit exists) but stopped. Give 30 min grace in case
  // agent is still running a long build/test step without writing heartbeats.
  const { data: staleWithCommit, error: wcErr } = await db
    .from('issues')
    .select('id,task_key,assignee,status,started_at,commit_sha')
    .in('status', WORKING_STATUSES)
    .is('heartbeat_at', null)
    .not('commit_sha', 'is', null)
    .not('started_at', 'is', null)
    .lt('started_at', fallbackCutoff)

  if (wcErr) return NextResponse.json({ error: wcErr.message }, { status: 500 })

  for (const issue of staleWithCommit ?? []) {
    await db.from('issues').update({
      status: 'open',
      started_at: null,
      worked_by: null,
      transitioned_by: 'cron-watchdog',
    }).eq('id', issue.id)
    cleared.push(issue.task_key)
    console.log(`[watchdog] stale with-commit → open: ${issue.task_key} (${issue.assignee}, commit ${issue.commit_sha?.slice(0,8)}, started ${issue.started_at})`)
  }

  // ── Query 1d: ghost claims — in_progress with null started_at (30 min) ───
  // SQL null < timestamp is always false, so above queries miss these entirely.
  // Only in_progress targeted — other statuses legitimately have null started_at
  // (deployer/auditor/PO use wipExtraFilter to distinguish claimed vs queued).
  const { data: ghostClaims, error: ghostErr } = await db
    .from('issues')
    .select('id,task_key,assignee,status,updated_at')
    .eq('status', 'in_progress')
    .is('started_at', null)
    .lt('updated_at', fallbackCutoff)

  if (ghostErr) return NextResponse.json({ error: ghostErr.message }, { status: 500 })

  for (const issue of ghostClaims ?? []) {
    await db.from('issues').update({
      status: 'open',
      started_at: null,
      heartbeat_at: null,
      worked_by: null,
      transitioned_by: 'cron-watchdog',
    }).eq('id', issue.id)
    cleared.push(issue.task_key)
    console.log(`[watchdog] ghost claim → open: ${issue.task_key} (${issue.assignee}, updated ${issue.updated_at})`)
  }

  // ── Query 1e: stale-block GC ─────────────────────────────────────────────
  // Issues with is_blocked=true where the blocking issue has reached a
  // terminal/completion status (closed, released, approved, completed).
  // The downstream-unblock in PATCH fires on transition, but if it was missed
  // (e.g. direct DB update, old code path), this catches the stragglers.
  // Also clears is_blocked=true where blocked_by IS NULL (zombie block flag).
  const unblockedKeys: string[] = []

  // 1e-i: blocked_by points to a resolved issue
  const { data: staleBlocked } = await db
    .from('issues')
    .select('id,task_key,blocked_by')
    .eq('is_blocked', true)
    .not('blocked_by', 'is', null)
    .in('status', ['open', 'refined', 'backlog', 'in_progress', 'code_review'])

  if (staleBlocked && staleBlocked.length > 0) {
    const blockingIdSet: Record<string, boolean> = {}
    staleBlocked.forEach(i => { if (i.blocked_by) blockingIdSet[i.blocked_by as string] = true })
    const blockingIds = Object.keys(blockingIdSet)
    const { data: blockingIssues } = await db
      .from('issues')
      .select('id,status')
      .in('id', blockingIds)
      .in('status', ['closed', 'released', 'approved', 'completed'])

    const resolvedBlockers = new Set((blockingIssues ?? []).map(i => i.id))
    for (const issue of staleBlocked) {
      if (resolvedBlockers.has(issue.blocked_by as string)) {
        await db.from('issues').update({
          is_blocked: false,
          blocked_by: null,
          updated_at: new Date().toISOString(),
        }).eq('id', issue.id)
        unblockedKeys.push(issue.task_key)
        console.log(`[watchdog] stale-block cleared: ${issue.task_key} (blocker ${issue.blocked_by} is resolved)`)
      }
    }
  }

  // 1e-ii: is_blocked=true but blocked_by IS NULL (zombie flag)
  const { data: zombieBlocked } = await db
    .from('issues')
    .select('id,task_key')
    .eq('is_blocked', true)
    .is('blocked_by', null)
    .in('status', ['open', 'refined', 'backlog', 'in_progress', 'code_review'])

  for (const issue of zombieBlocked ?? []) {
    await db.from('issues').update({
      is_blocked: false,
      updated_at: new Date().toISOString(),
    }).eq('id', issue.id)
    unblockedKeys.push(issue.task_key)
    console.log(`[watchdog] zombie-block cleared: ${issue.task_key} (is_blocked=true but no blocked_by)`)
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
    unblocked: unblockedKeys,
  })
}
