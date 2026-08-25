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

import { NextRequest, NextResponse } from 'next/server'
import { dbStatusMessage, isDbConfigured } from '@/lib/db'
import { classifyLiveness, readHeartbeat, recordHeartbeat } from '@/lib/agent-heartbeats'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

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

  // "Never checked in" is a real, nameable answer — not an empty 200 that the
  // caller has to guess at, and not a bare 404 with nothing in the body.
  if (!result.data) {
    return NextResponse.json(
      {
        error: `agent '${agentId}' has never checked in`,
        agent_id: agentId,
        liveness: 'never',
        store: result.store,
        warning: result.warning,
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
    },
    { headers: NO_STORE },
  )
}
