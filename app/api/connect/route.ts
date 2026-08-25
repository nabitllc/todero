// ─── POST /api/connect — agent self-registration handshake ──────────────────
//
// The entry point of the agent registration protocol (see lib/agent-
// registrations.ts and lib/agent-heartbeats.ts for the two tables behind it).
// Modelled on builderz-labs/mission-control's `POST /api/connect`: the
// client sends its identity once and the SERVER hands back the URLs to use
// next, so an agent hardcodes exactly one path (`/api/connect`) and
// discovers the rest. That is what makes the protocol versionable without
// touching every agent's config.
//
//   POST /api/connect
//     body: { tool_name, agent_name, tool_version?, agent_role?,
//              capabilities?, metadata? }   -- tool_name + agent_name required
//     -> 200 {
//          connection_id, agent_id, agent_name, runtime, status,
//          heartbeat_url,      -- POST every ~30s; GET polls for pending work
//          task_report_url,    -- PATCH /api/issues — Todero's one issue-report
//                                  endpoint (see CLAUDE.md "MC API"), not a
//                                  separate /tasks/{id}/complete like builderz
//          registered_at, capabilities, store, warning
//        }
//
//   DELETE /api/connect
//     body: { connection_id } or { agent_id }
//     -> 200 marks the agent 'offline' immediately AND clears its recorded
//        heartbeat, rather than waiting out the 10-minute heartbeat window.
//        Clearing the heartbeat too is what keeps GET /api/agents from
//        reading a still-fresh check-in and rendering a disconnected agent
//        as "On duty" until that window ages out on its own. The row itself
//        stays in `agent_registrations` (a later POST /api/connect revives
//        the same identity) — for a permanent removal see
//        DELETE /api/agents/{id}, which hard-deletes it.
//
// Re-POSTing is idempotent: it re-registers rather than erroring, matching
// builderz's documented "re-registering resets status and refreshes
// timestamps" behaviour.

import { NextRequest, NextResponse } from 'next/server'
import { dbUnavailableResponse } from '@/lib/db-http'
import { resolveAgentIdentity } from '@/lib/agent-roster'
import { registerAgent, readRegistrations, setRegistrationStatus } from '@/lib/agent-registrations'
import { recordHeartbeat, clearHeartbeat } from '@/lib/agent-heartbeats'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function toCapabilities(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export async function POST(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  // A connect with no body, or a body missing tool_name/agent_name, is still
  // a valid handshake — mirrors app/api/agents/[id]/heartbeat/route.ts's "a
  // heartbeat with no body is valid" rule. What builderz documents as
  // required fields become named DEFAULTS here rather than a 400: the caller
  // still gets a working connection_id and heartbeat_url back, and the
  // response says exactly what identity it registered (never a fabricated
  // one), so a minimal client can connect first and identify itself more
  // fully on a later re-connect.
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    /* no body, or not JSON — connect with defaults */
  }

  const toolName = toStringOrNull(body.tool_name) ?? 'unknown'
  const agentName = toStringOrNull(body.agent_name) ?? 'agent'

  // The same name -> id resolution the AGENTS.md roster parser uses, so an
  // agent that connects as "Builder" lands on the same id ('builder') the
  // roster and the heartbeat store already key on, instead of forking a
  // second identity for what is really the same agent.
  const { id: agentId, name: displayName } = resolveAgentIdentity(agentName)

  const metadata = body.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : {}
  const capabilities = toCapabilities(body.capabilities ?? metadata.capabilities)
  const connectionId = crypto.randomUUID()

  const result = await registerAgent({
    id: agentId,
    name: displayName,
    runtime: toolName,
    capabilities,
    connectionId,
  })

  if (!result.data) {
    return NextResponse.json(
      { error: result.warning ?? 'could not register the agent' },
      { status: 500, headers: NO_STORE },
    )
  }

  // Connecting IS a check-in: bridge into the same heartbeat store /api/agents
  // reads for liveness, so the Crew tab and Office roster show this agent as
  // live immediately rather than waiting for its first explicit heartbeat.
  await recordHeartbeat({ agentId, task: null })

  const heartbeatUrl = `/api/agents/${encodeURIComponent(agentId)}/heartbeat`

  return NextResponse.json(
    {
      connection_id: connectionId,
      agent_id: agentId,
      agent_name: result.data.name,
      runtime: result.data.runtime,
      status: result.data.status,
      // The point of the protocol: the server names the next paths, the
      // client hardcodes only this one.
      heartbeat_url: heartbeatUrl,
      sse_url: null, // Todero has no event-bus SSE endpoint yet — named honestly as absent, not omitted.
      task_report_url: '/api/issues', // Todero's one polymorphic issue-report endpoint (PATCH); see CLAUDE.md "MC API".
      registered_at: new Date(result.data.registeredAt).toISOString(),
      capabilities: result.data.capabilities,
      store: result.store,
      warning: result.warning,
    },
    { headers: NO_STORE },
  )
}

export async function GET() {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const result = await readRegistrations()
  return NextResponse.json(
    {
      agents: Array.from(result.data.values()).map((r) => ({
        agent_id: r.id,
        agent_name: r.name,
        runtime: r.runtime,
        status: r.status,
        capabilities: r.capabilities,
        registered_at: new Date(r.registeredAt).toISOString(),
        last_seen_at: new Date(r.lastSeenAt).toISOString(),
      })),
      store: result.store,
      warning: result.warning,
    },
    { headers: NO_STORE },
  )
}

export async function DELETE(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    /* no body */
  }

  let agentId = toStringOrNull(body.agent_id)
  const connectionId = toStringOrNull(body.connection_id)

  if (!agentId && connectionId) {
    // connection_id is not the primary key, so disconnecting by it alone
    // means a scan — acceptable at fleet scale (tens of agents, not millions).
    const all = await readRegistrations()
    const match = Array.from(all.data.values()).find((reg) => reg.connectionId === connectionId)
    if (match) agentId = match.id
  }

  if (!agentId) {
    return NextResponse.json(
      { error: 'agent_id or a connection_id that matches a registered agent is required' },
      { status: 400, headers: NO_STORE },
    )
  }

  const result = await setRegistrationStatus(agentId, 'offline')
  if (!result.data) {
    return NextResponse.json(
      { error: result.warning ?? `agent '${agentId}' is not registered`, agent_id: agentId },
      { status: 404, headers: NO_STORE },
    )
  }

  // The registration row is now backdated 'offline', but the heartbeat this
  // agent sent moments ago (connecting itself records one — see the POST
  // handler above) is still sitting in `agent_heartbeats`/`agent_memory`,
  // inside LIVE_WINDOW_MS. Left alone, GET /api/agents would keep reading
  // THAT row for liveness and render this agent as "On duty" for up to ten
  // more minutes after it explicitly disconnected. Clearing it here, in the
  // same request, is what makes the disconnect visible on the very next
  // poll instead of only after the heartbeat window ages out on its own.
  // Best-effort: a failure to clear the heartbeat must not turn an otherwise
  // successful disconnect into an error, since buildRegistrationAgent() in
  // app/api/agents/route.ts also floors liveness at the registration's own
  // (now backdated) last_seen_at as a second line of defense.
  const heartbeatClear = await clearHeartbeat(agentId)

  return NextResponse.json(
    {
      ok: true,
      agent_id: agentId,
      status: result.data.status,
      store: result.store,
      warning: result.warning ?? heartbeatClear.warning,
    },
    { headers: NO_STORE },
  )
}
