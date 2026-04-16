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

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { issue_id?: string; task_key?: string }
  const { issue_id, task_key } = body

  if (!issue_id && !task_key) {
    return NextResponse.json({ error: 'issue_id or task_key required' }, { status: 400 })
  }

  const db = createAdminClient()
  const now = new Date().toISOString()

  let query = db.from('issues').update({ heartbeat_at: now })

  if (issue_id) {
    query = query.eq('id', issue_id)
  } else {
    query = query.eq('task_key', task_key as string)
  }

  // Only update if status is in_progress — don't write heartbeats on closed/open issues
  const { error } = await query.eq('status', 'in_progress')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, heartbeat_at: now })
}
