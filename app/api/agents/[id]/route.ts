// ─── DELETE /api/agents/[id] — permanent deregistration ──────────────────────
//
// DELETE /api/connect marks a registered agent 'offline' and clears its
// heartbeat, but deliberately leaves the row in `agent_registrations` in
// place — a later POST /api/connect from the same identity should revive it,
// not fork a second one. That is a disconnect, not a removal.
//
// This is the separate, explicit action for a test agent or a retired one
// that should stop appearing in the Crew tab and Office roster forever: it
// hard-deletes the registration row (see lib/agent-registrations.ts's
// deleteRegistration) and clears any heartbeat still sitting in the store
// alongside it, the same pairing DELETE /api/connect makes. Exposed as the
// "Remove" action on a self-registered agent's card in AgentDetailView.
//
// Only applies to agents that came from POST /api/connect (rosterSource
// 'registered' on the AgentDto). An agent named in AGENTS.md has no
// registration row to delete — this 404s for it, same as for any id that
// was never registered — the roster file itself is not touched here.
//
//   DELETE /api/agents/<id>
//     -> 200 { ok, agent_id, store, warning }
//     -> 404 { error, agent_id } when the id was never registered
//     -> 503 when the database is not configured

import { NextRequest, NextResponse } from 'next/server'
import { dbUnavailableResponse } from '@/lib/db-http'
import { deleteRegistration } from '@/lib/agent-registrations'
import { clearHeartbeat } from '@/lib/agent-heartbeats'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = params.id?.trim()
  if (!agentId) {
    return NextResponse.json({ error: 'agent id is required in the path' }, { status: 400, headers: NO_STORE })
  }

  const result = await deleteRegistration(agentId)
  // deleteRegistration() never hands back the row it removed (its `data` is
  // always null), so `store` is the success signal here: non-null only when
  // a delete actually ran against a real table. Null covers three distinct
  // causes — not configured, id never registered, or the delete itself
  // failed — split apart by whether an underlying DbError came back.
  if (result.store === null) {
    if (result.error) {
      return NextResponse.json(
        { error: result.warning ?? 'could not delete the registration', agent_id: agentId },
        { status: 500, headers: NO_STORE },
      )
    }
    return NextResponse.json(
      { error: result.warning ?? `agent '${agentId}' is not registered`, agent_id: agentId },
      { status: 404, headers: NO_STORE },
    )
  }

  // Best-effort: the registration is already gone by the time this runs, so
  // a leftover heartbeat row must not turn a successful deregistration into
  // an error — it would only ever resurface if something re-registers this
  // same id, at which point recordHeartbeat() overwrites it anyway.
  const heartbeatClear = await clearHeartbeat(agentId)

  return NextResponse.json(
    { ok: true, agent_id: agentId, store: result.store, warning: heartbeatClear.warning },
    { headers: NO_STORE },
  )
}
