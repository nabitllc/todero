// /api/heartbeat — agent liveness signal
//
// Agents PATCH this every ~5 minutes while working on a task.
// The watchdog uses heartbeat_at to detect dead agents in 10 min
// instead of waiting 20-30 min for started_at to go stale.
//
// Usage:
//   curl -s -X PATCH http://localhost:3000/api/heartbeat \
//     -H "Content-Type: application/json" \
//     -d '{"issue_id":"<uuid>"}'
//   OR
//   curl -s -X PATCH http://localhost:3000/api/heartbeat \
//     -H "Content-Type: application/json" \
//     -d '{"task_key":"TOD-1234"}'

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { recordHeartbeat } from '@/lib/agent-heartbeats'

export async function PATCH(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as { issue_id?: string; task_key?: string }
  const { issue_id, task_key } = body

  if (!issue_id && !task_key) {
    return NextResponse.json({ error: 'issue_id or task_key required' }, { status: 400 })
  }

  const db = createAdminClient()
  const now = new Date().toISOString()

  // Who owns this issue — so the same beat that keeps the watchdog quiet also
  // counts as this AGENT's liveness. Agents already call this endpoint every
  // ~5 min while working; before this, none of that traffic reached the agent
  // roster, which is why /api/agents could only ever guess who was running.
  const ownerLookup = db.from('issues').select('task_key, assignee, worked_by')
  const { data: ownerRows } = await (issue_id
    ? ownerLookup.eq('id', issue_id)
    : ownerLookup.eq('task_key', task_key as string)
  ).limit(1)
  const ownerRow = Array.isArray(ownerRows) ? ownerRows[0] : null
  const owner: string | null = ownerRow?.worked_by || ownerRow?.assignee || null

  let query = db.from('issues').update({ heartbeat_at: now })

  if (issue_id) {
    query = query.eq('id', issue_id)
  } else {
    query = query.eq('task_key', task_key as string)
  }

  // Only update if status is a working status — agents heartbeat while:
  // - builder/ops/scout work on 'in_progress'
  // - tester/designer work on 'code_review'
  // - po works on 'refined'
  // - deployer works on 'approved'
  // - auditor works on 'released'
  const { error } = await query.in('status', ['in_progress', 'code_review', 'refined', 'approved', 'released'])

  if (error) {
    return dbQueryErrorResponse(error, 'issues')
  }

  // Same beat, second reader: the agent roster. A failure here does not fail
  // the request — the issue heartbeat, which the watchdog depends on, is
  // already written — but it is reported so a degraded store is never silent.
  let agentBeat: { agent_id: string; store: string | null; warning: string | null } | null = null
  if (owner) {
    const recorded = await recordHeartbeat({
      agentId: owner,
      task: ownerRow?.task_key ?? task_key ?? null,
    })
    agentBeat = { agent_id: owner, store: recorded.store, warning: recorded.warning }
  }

  return NextResponse.json({ ok: true, heartbeat_at: now, agent: agentBeat })
}
