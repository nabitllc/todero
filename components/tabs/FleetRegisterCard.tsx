'use client'
// ─── components/tabs/FleetRegisterCard.tsx — fleet-cards piece ───────────────
//
// design/Fleet.dc.html's third panel is "Register an agent": the handshake an
// agent performs to become a row in the roster above it. The app had no such
// surface at all — `POST /api/connect` existed, the acceptance harness proved
// it, and nothing on screen told an operator (or an agent author) that it was
// there or what it hands back.
//
// This card is documentation of a REAL endpoint, next to a REAL count of the
// rows that endpoint has created. The two halves are deliberately different
// kinds of claim and are labelled as such:
//
//   - the number and the register list come from `GET /api/connect`, live;
//   - the request/response block is the CONTRACT — quoted from
//     app/api/connect/route.ts, not from a response captured here. This card
//     never POSTs. Calling the handshake to "show what it returns" would
//     register a phantom agent into the very roster the Fleet surface is
//     supposed to tell the truth about.
//
// The heartbeat rule under the block is the artboard's, and the two numbers in
// it are imported from lib/fleet-liveness.ts rather than retyped, so the
// documented protocol and the code that classifies against it cannot drift.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'
import { HEARTBEAT_INTERVAL_MS, OFFLINE_AFTER_MS, formatAge } from '@/lib/fleet-liveness'

/** One row of `GET /api/connect` — see that route's GET handler. */
interface RegisteredAgent {
  agent_id: string
  agent_name: string
  runtime: string
  status: string
  registered_at: string
  last_seen_at: string
}

interface ConnectRegister {
  agents: RegisteredAgent[]
  /** Which table answered — `agent_registrations`, or its fallback. */
  store: string | null
  warning: string | null
}

const ENDPOINT = '/api/connect'

/**
 * The response contract, verbatim from app/api/connect/route.ts's POST
 * handler. `sse_url` is included precisely because it is null: the route
 * names the absent capability rather than omitting the field, and hiding that
 * here would make the protocol look more complete than it is.
 */
const HANDSHAKE = `POST /api/connect
  { tool_name, agent_name }   // both optional; the reply names what it registered
→ { connection_id, agent_id, agent_name, runtime, status,
    heartbeat_url,      // POST to beat; GET to poll for work
    sse_url: null,      // this instance has no event bus
    task_report_url,    // "/api/issues" — PATCH to report a task
    registered_at, capabilities, store, warning }

DELETE /api/connect { connection_id } | { agent_id }
→ marks the agent offline and clears its heartbeat`

export default function FleetRegisterCard({ id = 'fleet-register' }: { id?: string }) {
  const [register, setRegister] = useState<ConnectRegister | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const r = await fetchJson<ConnectRegister>(ENDPOINT)
    if (r.ok) {
      setRegister(r.data)
      setError(null)
    } else {
      // The error REPLACES the body below — never an empty register rendered
      // over a request that was refused.
      setRegister(null)
      setError(r.error)
    }
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])

  const rows = register?.agents ?? []

  // `GET /api/connect` returns every registration row — it takes no limit or
  // offset — so this length is the exact number of completed handshakes, not
  // the size of a page.
  const source = (
    <>
      GET {ENDPOINT} — every row of {register?.store ?? 'agent_registrations'}, no limit/offset, so the count is exact
      <br />
      request/response block below: the contract in app/api/connect/route.ts. This card never POSTs.
    </>
  )

  if (error) {
    return (
      <Card id={id} title="How does an agent join this fleet?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <Card
      id={id}
      title="How does an agent join this fleet?"
      source={source}
      metric={loaded ? { value: rows.length, label: rows.length === 1 ? 'completed handshake' : 'completed handshakes' } : undefined}
    >
      <div className="space-y-3">
        <pre className="font-mono text-[10.5px] leading-relaxed text-white/55 bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 overflow-x-auto">
{HANDSHAKE}
        </pre>

        <p className="text-white/45 text-[11px] leading-relaxed">
          Heartbeat every {formatAge(HEARTBEAT_INTERVAL_MS)}. Offline after {formatAge(OFFLINE_AFTER_MS)} of silence.
          A <span className="font-mono text-white/60">GET</span> on the heartbeat URL returns this agent&apos;s
          pending work (<span className="font-mono text-white/60">pending_tasks</span>,{' '}
          <span className="font-mono text-white/60">total_items</span>), so an agent behind a firewall that cannot
          hold a connection open still gets its tasks by polling the same URL it beats to.
        </p>

        {register?.warning && (
          <p className="text-amber-300/80 text-[11px] leading-relaxed break-words">{register.warning}</p>
        )}

        {loaded && rows.length === 0 ? (
          // Names the fleet, not a bare "nothing here": the register being
          // empty is a fact about this instance's handshakes, and it is
          // different from the roster being empty — AGENTS.md and the Brain2
          // vault put agents in the roster without any handshake at all.
          <p className="text-white/45 text-xs">
            No agent has completed the {ENDPOINT} handshake on this instance, so the register is empty. Roster rows
            that come from AGENTS.md or a Brain2 manifest are declared, not self-registered — they appear above
            without ever having connected.
          </p>
        ) : (
          <ul className="divide-y divide-white/5 border-t border-white/5">
            {rows.map(r => (
              <li key={r.agent_id} className="flex items-center gap-2 py-1.5 text-[11px]">
                <span className="text-white/80 font-medium truncate">{r.agent_name}</span>
                <span className="font-mono text-white/35 truncate">{r.agent_id}</span>
                <span className="flex-1" />
                <span className="font-mono text-white/35 shrink-0">runtime: {r.runtime}</span>
                <span className="font-mono text-white/45 shrink-0">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
