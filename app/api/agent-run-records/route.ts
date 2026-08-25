// TOD-489 repair (memory-loop-write piece) — structured post-task memory.
//
// Replaces the write target of post-task-memory.sh / promote-hot-patterns.sh:
// one queryable row per agent run in agent_run_records, instead of a
// free-text corrections.md entry under a hardcoded macOS home directory.
// See migrations/038_agent_run_records.sql and docs/brain2-integration.md.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

// Reads the DB at request time — same reasoning as app/api/agent-memory/route.ts.
export const dynamic = 'force-dynamic'

interface RunRecordBody {
  agent_id?: string
  task_key?: string
  task_title?: string
  status?: string
  attempted?: string
  succeeded?: boolean
  failed?: boolean
  rejection_count?: number
  rejection_reason?: string | null
  reviewer_notes?: string | null
  exit_status?: number | null
}

export async function GET(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = req.nextUrl.searchParams.get('agent_id')
  const taskKey = req.nextUrl.searchParams.get('task_key')
  const rejectedOnly = req.nextUrl.searchParams.get('rejected_only') === '1'
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100

  let query = db().from('agent_run_records').select('*').order('created_at', { ascending: false })
  if (agentId) query = query.eq('agent_id', agentId)
  if (taskKey) query = query.eq('task_key', taskKey)
  if (rejectedOnly) query = query.eq('failed', true)

  const { data, error } = await query.limit(limit)
  if (error) return dbQueryErrorResponse(error, 'agent_run_records')
  return NextResponse.json({ records: data })
}

export async function POST(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  // Same auth shape as app/api/agent-memory/route.ts: localhost (the queue
  // loop running on the same host as the dev/prod server) or a bearer token
  // matching CRON_SECRET for anything remote.
  const secret = process.env.CRON_SECRET
  const host = req.headers.get('host') || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (secret && !isLocalhost && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as RunRecordBody
  if (!body.agent_id || !body.task_key) {
    return NextResponse.json({ error: 'agent_id and task_key are required' }, { status: 400 })
  }

  const { data, error } = await db()
    .from('agent_run_records')
    .insert({
      agent_id: body.agent_id,
      task_key: body.task_key,
      task_title: body.task_title ?? null,
      status: body.status ?? null,
      attempted: body.attempted ?? null,
      succeeded: body.succeeded ?? false,
      failed: body.failed ?? false,
      rejection_count: body.rejection_count ?? 0,
      rejection_reason: body.rejection_reason ?? null,
      reviewer_notes: body.reviewer_notes ?? null,
      exit_status: body.exit_status ?? null,
    })
    .select()
    .single()

  if (error) return dbQueryErrorResponse(error, 'agent_run_records')
  return NextResponse.json(data, { status: 201 })
}
