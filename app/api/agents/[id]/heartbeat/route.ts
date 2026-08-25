// ─── /api/agents/[id]/heartbeat — the agent liveness endpoint ────────────────
//
// The "Run Heartbeat" button in the agent detail view POSTed here and got a
// 404 for its trouble, then alerted "Heartbeat triggered" regardless. This is
// the endpoint that was missing, and it is the ONLY thing /api/agents now uses
// to decide whether an agent is running.
//
//   POST /api/agents/builder/heartbeat
//        body (all optional): { "pid": 1234, "host": "ci-runner-2", "task": "TOD-2400" }
//        -> 200 { ok, agent_id, last_seen, liveness, store }
//
//   GET  /api/agents/builder/heartbeat
//        -> 200 with the recorded beat, or
//           404 { error, agent_id } when that agent has never checked in.
//
// Agents are expected to POST about every 30s while working. /api/agents reads
// the recorded rows and reports `live` under 60s, `stale` under 10 min, `idle`
// beyond that, and `never` for an agent with no row at all.
//
// The GET direction also carries `pending_tasks`: a firewalled agent that
// cannot hold an SSE connection open still gets its work by polling the same
// URL it already pings for liveness (the same design point builderz-labs/
// mission-control's `GET /api/agents/{id}/heartbeat` makes). It is issues
// assigned to this agent id (assignee OR worked_by) sitting in a status the
// agent should act on — 'open' (claimed, not started) or 'in_progress'
// (already working it, e.g. after a restart) — ordered the same way
// lib/agent-queue.ts sorts its own queues (`priority.asc`).

import { NextRequest, NextResponse } from 'next/server'
import { db, dbStatusMessage, isDbConfigured } from '@/lib/db'
import { classifyLiveness, readHeartbeat, recordHeartbeat } from '@/lib/agent-heartbeats'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** Statuses this endpoint considers "this agent has work waiting". */
const PENDING_STATUSES = ['open', 'in_progress'] as const

type PendingTask = {
  task_key: string | null
  title: string
  status: string
  priority: string | null
}

/**
 * Issues assigned to `agentId` in a pending status. Never throws: a query
 * failure here must not fail the heartbeat POST/GET itself, so it degrades to
 * an empty list plus `null` rather than propagating.
 */
async function fetchPendingTasks(agentId: string): Promise<PendingTask[] | null> {
  try {
    const { data, error } = await db()
      .from('issues')
      .select('task_key,title,status,priority')
      .or([
        { column: 'assignee', op: 'eq', value: agentId },
        { column: 'worked_by', op: 'eq', value: agentId },
      ])
      .in('status', [...PENDING_STATUSES])
      .order('priority', { ascending: true })
      .limit(10)
    if (error) return null
    return Array.isArray(data) ? (data as PendingTask[]) : []
  } catch {
    return null
  }
}

/** 503 naming the variables the active adapter wants but cannot find. */
function unconfigured(): NextResponse {
  return NextResponse.json({ error: dbStatusMessage() }, { status: 503, headers: NO_STORE })
}

function toIntOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDbConfigured()) return unconfigured()

  const agentId = params.id?.trim()
  if (!agentId) {
    return NextResponse.json({ error: 'agent id is required in the path' }, { status: 400, headers: NO_STORE })
  }

  // A heartbeat with no body is valid — an agent that only wants to say "still
  // here" should not have to send JSON to do it.
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    /* no body, or not JSON — the check-in still counts */
  }

  const result = await recordHeartbeat({
    agentId,
    pid: toIntOrNull(body.pid),
    host: toStringOrNull(body.host),
    task: toStringOrNull(body.task),
  })

  if (!result.data) {
    return NextResponse.json(
      { error: result.warning ?? 'could not record the heartbeat', agent_id: agentId },
      { status: 500, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    {
      ok: true,
      agent_id: result.data.agentId,
      last_seen: new Date(result.data.lastSeen).toISOString(),
      lastSeenAt: result.data.lastSeen,
      pid: result.data.pid,
      host: result.data.host,
      task: result.data.task,
      liveness: classifyLiveness(result.data.lastSeen),
      // Which table took the write, and the warning when it was not the
      // dedicated one. Silent degradation is how a dashboard starts lying.
      store: result.store,
      warning: result.warning,
    },
    { headers: NO_STORE },
  )
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDbConfigured()) return unconfigured()

  const agentId = params.id?.trim()
  if (!agentId) {
    return NextResponse.json({ error: 'agent id is required in the path' }, { status: 400, headers: NO_STORE })
  }

  const result = await readHeartbeat(agentId)
  const pendingTasks = await fetchPendingTasks(agentId)

  // "Never checked in" is a real, nameable answer — not an empty 200 that the
  // caller has to guess at, and not a bare 404 with nothing in the body. Work
  // may still be waiting for an agent that has never checked in (e.g. it was
  // just assigned before its first connect), so pending_tasks is populated
  // here too rather than only on the 200 path.
  if (!result.data) {
    return NextResponse.json(
      {
        error: `agent '${agentId}' has never checked in`,
        agent_id: agentId,
        liveness: 'never',
        store: result.store,
        warning: result.warning,
        pending_tasks: pendingTasks ?? [],
        total_items: pendingTasks?.length ?? 0,
      },
      { status: 404, headers: NO_STORE },
    )
  }

  return NextResponse.json(
    {
      agent_id: result.data.agentId,
      last_seen: new Date(result.data.lastSeen).toISOString(),
      lastSeenAt: result.data.lastSeen,
      pid: result.data.pid,
      host: result.data.host,
      task: result.data.task,
      liveness: classifyLiveness(result.data.lastSeen),
      store: result.store,
      warning: result.warning,
      // Polling surface for a firewalled agent that cannot hold an SSE stream
      // open: GET this same URL and act on what comes back instead.
      pending_tasks: pendingTasks ?? [],
      total_items: pendingTasks?.length ?? 0,
      status: pendingTasks && pendingTasks.length > 0 ? 'WORK_ITEMS_FOUND' : 'NO_WORK',
    },
    { headers: NO_STORE },
  )
}
