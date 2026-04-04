// TOD-576: Unified per-agent autonomous queue movement endpoint
// POST /api/run-agent?agent=builder (or tester, scout, security, community, content)
//
// One-at-a-time lane enforcement:
//   1. Check WIP limit for the agent
//   2. Fetch eligible issues matching the agent's queue config
//   3. Apply DoR gate (skip issues missing required fields)
//   4. Apply blocked-item skip (if enabled)
//   5. Pick the top-priority issue
//   6. Move it to workingStatus and log agent_run
//   7. Return the selected issue for the caller to dispatch

import { NextRequest, NextResponse } from 'next/server'
import { getQueueConfig, getAllQueueAgentIds } from '@/lib/agent-queue'
import { satisfiesIssueDependency } from '@/lib/issue-lifecycle'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const HEADERS = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const agentId = req.nextUrl.searchParams.get('agent')
  if (!agentId) {
    return NextResponse.json(
      { error: 'Missing ?agent= parameter', available: getAllQueueAgentIds() },
      { status: 400 }
    )
  }

  const config = getQueueConfig(agentId)
  if (!config) {
    return NextResponse.json(
      { error: `Unknown agent: ${agentId}`, available: getAllQueueAgentIds() },
      { status: 400 }
    )
  }

  // ── Step 1: WIP limit check ──
  const wipRes = await fetch(
    `${SUPA_URL}/rest/v1/issues?assignee=eq.${agentId}&status=eq.${config.workingStatus}&select=id`,
    { headers: HEADERS }
  )
  const wipIssues = await wipRes.json() as Array<{ id: string }>
  if (Array.isArray(wipIssues) && wipIssues.length >= config.wipLimit) {
    return NextResponse.json({
      agent: agentId,
      message: `WIP limit reached: ${wipIssues.length}/${config.wipLimit} ${config.workingStatus}. Finish current work first.`,
      wip: wipIssues.length,
    })
  }

  // ── Step 2: Fetch eligible issues ──
  const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
  const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
  const url = `${SUPA_URL}/rest/v1/issues?assignee=eq.${agentId}&status=eq.${config.pickupStatus}&${dorFilter}${extraFilter}&select=id,title,description,priority,due_date,project,acceptance_criteria,task_key,feature_branch,blocked_by&order=${config.sortOrder}&limit=${config.fetchLimit}`

  const res = await fetch(url, { headers: HEADERS })
  const tasks = await res.json() as Array<{
    id: string; title: string; description: string; priority: string;
    due_date: string | null; project: string; acceptance_criteria: string | null;
    task_key: string | null; feature_branch: string | null;
    blocked_by: string | null
  }>

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({
      agent: agentId,
      message: `No eligible issues for ${agentId} (status=${config.pickupStatus}, DoR fields: ${config.dorFields.join(', ')})`,
    })
  }

  // ── Step 3: Blocked-item skip ──
  let readyTasks = tasks
  if (config.checkBlocking) {
    const blockedByIds = tasks.filter(t => t.blocked_by).map(t => t.blocked_by!)
    let blockerStatuses: Record<string, string> = {}

    if (blockedByIds.length > 0) {
      const blockerRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?or=(id.in.(${blockedByIds.join(',')}),task_key.in.(${blockedByIds.join(',')}))&select=id,task_key,status`,
        { headers: HEADERS }
      )
      const blockers = await blockerRes.json() as Array<{ id: string; task_key: string | null; status: string }>
      if (Array.isArray(blockers)) {
        for (const b of blockers) {
          blockerStatuses[b.id] = b.status
          if (b.task_key) blockerStatuses[b.task_key] = b.status
        }
      }
    }

    readyTasks = tasks.filter(t => {
      if (!t.blocked_by) return true
      const blockerStatus = blockerStatuses[t.blocked_by]
      return satisfiesIssueDependency(blockerStatus)
    })
  }

  if (readyTasks.length === 0) {
    return NextResponse.json({
      agent: agentId,
      message: 'All eligible issues are blocked by unfinished dependencies',
      blocked: tasks.filter(t => t.blocked_by).map(t => ({
        task_key: t.task_key, blocked_by: t.blocked_by,
      })),
    })
  }

  // ── Step 4: Priority sort (fallback — Supabase already sorts, but ensure consistency) ──
  readyTasks.sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority)
    const pb = PRIORITY_ORDER.indexOf(b.priority)
    if (pa !== pb) return pa - pb
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })

  const task = readyTasks[0]

  // ── Step 5: Move to workingStatus (unless already in that status, e.g. tester) ──
  if (config.pickupStatus !== config.workingStatus) {
    await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
      method: 'PATCH',
      headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        status: config.workingStatus,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
  }

  // ── Step 6: Log agent_run ──
  await fetch(`${SUPA_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      agent_id: agentId,
      task_id: task.id,
      task_title: task.title,
      status: 'running',
    }),
  })

  // ── Step 7: Return task for dispatch ──
  return NextResponse.json({
    ok: true,
    agent: agentId,
    task: {
      id: task.id,
      title: task.title,
      taskKey: task.task_key,
      project: task.project,
      priority: task.priority,
      branch: task.feature_branch,
      description: task.description,
      acceptanceCriteria: task.acceptance_criteria,
    },
    prompt: `${config.promptPrefix}\n\nTask: ${task.task_key ?? ''} — ${task.title}\nProject: ${task.project}\nAcceptance Criteria:\n${task.acceptance_criteria ?? 'See description'}\n\nDescription:\n${task.description ?? 'See title'}`,
    wip: (wipIssues?.length ?? 0) + 1,
    wipLimit: config.wipLimit,
    skippedBlocked: tasks.length - readyTasks.length,
  })
}

// GET /api/run-agent — status/heartbeat for all queue lanes
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent')
  const agentIds = agentId ? [agentId] : getAllQueueAgentIds()

  const lanes = await Promise.all(
    agentIds.map(async (id) => {
      const config = getQueueConfig(id)
      if (!config) return { agent: id, error: 'unknown agent' }

      // Count WIP
      const wipRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.workingStatus}&select=id`,
        { headers: HEADERS }
      )
      const wipIssues = await wipRes.json() as Array<{ id: string }>

      // Count eligible
      const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
      const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
      const eligibleRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.pickupStatus}&${dorFilter}${extraFilter}&select=id&limit=100`,
        { headers: HEADERS }
      )
      const eligible = await eligibleRes.json() as Array<{ id: string }>

      return {
        agent: id,
        wip: Array.isArray(wipIssues) ? wipIssues.length : 0,
        wipLimit: config.wipLimit,
        eligible: Array.isArray(eligible) ? eligible.length : 0,
        pickupStatus: config.pickupStatus,
        workingStatus: config.workingStatus,
      }
    })
  )

  return NextResponse.json({ lanes, timestamp: new Date().toISOString() })
}
