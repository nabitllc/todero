'use client'

// Fleet -> "Who is accountable when work stalls?"
//
// The one card that answers a question the roster and the capability map
// cannot: not who exists, and not what they can do, but who OWNS an area of
// the business and who answers when it stalls.
//
// Card contract (components/nav/Card.tsx): one question as the title, one
// number from a real query, that query printed as `source`, one action, an
// empty state that names the fleet, and an error that REPLACES the body rather
// than sitting next to a stale number.
//
// THE HONEST LIMIT, ON SCREEN
//   Nothing consults these assignments. The notice below is `not_consulted_notice`
//   from the API, which is `notConsultedNotice(RESPONSIBILITY_CONSUMERS)` in
//   lib/agent-responsibilities.ts — a real function of that list, so adding a
//   consumer to it does change this sentence in the same commit.
//
//   What that list is NOT is automatic. It is maintained by hand. Nothing scans
//   for consumers, and this comment previously claimed the change happened
//   "automatically", which was false: NOT_CONSULTED_NOTICE was a flat string
//   that never read the array, and this card rendered it unconditionally
//   ALONGSIDE a "Read by: …" clause — so a populated list would have printed
//   "Nothing acts on these assignments yet" and "Read by: agent-queue" together.
//   The single derived sentence below is now the only thing rendered, and a test
//   in lib/__tests__/agent-responsibilities.test.ts fails when a new module
//   starts consuming the rows while the list is still empty.
//
//   A responsibility table rendered as though the fleet obeyed it would be a
//   fabrication; saying so is the whole point of the line.
//
// Every agent id in the picker comes from the roster the API returns. There is
// no agent name in this file.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'
import { RESPONSIBILITY_LEVELS, type ResponsibilityLevel } from '@/lib/agent-responsibilities'

const CARD_ID = 'fleet-responsibilities'
const TITLE = 'Who is accountable when work stalls?'

interface AreaCoverage {
  area: string
  label: string
  question: string
  evidence: string
  accountable: string | null
  responsible: string[]
}

interface Payload {
  areas: AreaCoverage[]
  assignments: { area: string; agent_id: string; level: ResponsibilityLevel; capability_backed: boolean | null }[]
  covered_areas: number
  total_areas: number
  fleet: { agents: string[]; source: string | null; warning: string | null }
  consulted_by: string[]
  not_consulted_notice: string
  source: string
}

export default function ResponsibilitiesCard({ hubName }: { hubName: string | null }) {
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<{ area: string; agent: string; level: ResponsibilityLevel }>({
    area: '', agent: '', level: 'accountable',
  })
  const [busy, setBusy] = useState(false)

  const endpoint = '/api/agent-responsibilities'

  useEffect(() => {
    if (!hubName) { setLoaded(true); return }
    let live = true
    ;(async () => {
      try {
        const res = await fetch('/api/businesses')
        if (!res.ok) { if (live) { setError(await readApiError(res, '/api/businesses')); setLoaded(true) } return }
        const rows = (await res.json()) as { id?: string; name?: string }[]
        if (live) setBusinessId(rows.find(b => b.name === hubName)?.id ?? null)
      } catch (e) {
        if (live) { setError({ status: 0, endpoint: '/api/businesses', message: e instanceof Error ? e.message : 'could not reach the server' }); setLoaded(true) }
      }
    })()
    return () => { live = false }
  }, [hubName])

  const load = useCallback(async () => {
    if (!businessId) return
    const url = `${endpoint}?business_id=${encodeURIComponent(businessId)}`
    try {
      const res = await fetch(url)
      if (!res.ok) { setError(await readApiError(res, endpoint)); setData(null); setLoaded(true); return }
      setError(null)
      setData((await res.json()) as Payload)
      setLoaded(true)
    } catch (e) {
      setError({ status: 0, endpoint, message: e instanceof Error ? e.message : 'could not reach the server' })
      setData(null)
      setLoaded(true)
    }
  }, [businessId])

  useEffect(() => { void load() }, [load])

  async function write(method: 'POST' | 'DELETE', body: Record<string, unknown>) {
    if (!businessId) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, ...body }),
      })
      if (!res.ok) { setError(await readApiError(res, endpoint)); return }
      setError(null)
      setOpen(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  // ── Error REPLACES the body. No metric, no stale table beside a failure. ──
  if (error) {
    return (
      <Card id={CARD_ID} title={TITLE} source={`${endpoint}?business_id=${businessId ?? '<unresolved>'}`}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }
  if (!hubName || (loaded && !businessId)) {
    return (
      <Card id={CARD_ID} title={TITLE}
        empty={{ active: true, message: `No hub is selected${hubName ? ` and none is named "${hubName}"` : ''}, so there is no fleet whose responsibilities could be shown.` }} />
    )
  }
  if (!loaded || !data) {
    return <Card id={CARD_ID} title={TITLE}><span className="text-white/40 text-sm">Loading…</span></Card>
  }

  const fleetSize = data.fleet.agents.length
  const fleetWhere = data.fleet.source ?? 'no roster file was found'

  // A fleet of zero is the one genuinely empty case: there is nobody to assign
  // anything to. Name the fleet and where it was looked for.
  if (fleetSize === 0) {
    return (
      <Card id={CARD_ID} title={TITLE} source={data.source}
        empty={{ active: true, message: `The roster declares no agents (${data.fleet.warning ?? fleetWhere}), so none of the ${data.total_areas} declared areas can have an owner yet.` }} />
    )
  }

  const tone = data.covered_areas === 0 ? 'red' : data.covered_areas === data.total_areas ? 'emerald' : 'amber'
  const unassigned = data.fleet.agents.filter(a => !data.assignments.some(x => x.agent_id === a))

  return (
    <Card
      id={CARD_ID}
      title={TITLE}
      source={data.source}
      metric={{ value: `${data.covered_areas}/${data.total_areas}`, label: 'areas have an owner', tone }}
      action={{ label: open ? 'Cancel' : 'Assign', onClick: () => setOpen(o => !o) }}
    >
      <div className="space-y-3">
        <p className="text-white/50 text-xs leading-relaxed">
          {data.covered_areas === 0
            ? `No agent owns any of the ${data.total_areas} areas yet. `
            : `${data.covered_areas} of ${data.total_areas} areas have someone accountable. `}
          The fleet declares <span className="text-white/80">{fleetSize}</span> agent{fleetSize === 1 ? '' : 's'}, read from{' '}
          <span className="font-mono text-white/60 break-all">{fleetWhere}</span>
          {unassigned.length > 0 && <> — <span className="text-white/80">{unassigned.length}</span> of them own nothing.</>}
        </p>

        {/* The honest limit, from the API rather than hardcoded here. ONE
            sentence: it already names the consumers when there are any, so a
            second "Read by:" clause here would contradict the empty-list
            wording the moment the list stopped being empty. */}
        <p className="text-amber-300/80 text-xs leading-relaxed border border-amber-400/20 bg-amber-400/5 rounded-lg px-3 py-2">
          {data.not_consulted_notice}
        </p>

        {open && (
          <div className="flex flex-wrap items-center gap-2 border border-white/10 rounded-lg p-2">
            <select aria-label="Area" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
              className="bg-black/40 border border-white/15 rounded-md text-xs text-white/80 px-2 py-1">
              <option value="">Choose an area…</option>
              {data.areas.map(a => <option key={a.area} value={a.area}>{a.label}</option>)}
            </select>
            <select aria-label="Agent" value={form.agent} onChange={e => setForm(f => ({ ...f, agent: e.target.value }))}
              className="bg-black/40 border border-white/15 rounded-md text-xs text-white/80 px-2 py-1">
              <option value="">Choose an agent…</option>
              {data.fleet.agents.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
            <select aria-label="Level" value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value as ResponsibilityLevel }))}
              className="bg-black/40 border border-white/15 rounded-md text-xs text-white/80 px-2 py-1">
              {RESPONSIBILITY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button
              disabled={busy || !form.area || !form.agent}
              onClick={() => void write('POST', { area: form.area, agent_id: form.agent, level: form.level })}
              className="text-xs text-white/80 border border-white/20 rounded-md px-2.5 py-1 disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}

        <ul className="divide-y divide-white/5">
          {data.areas.map(area => {
            const backing = data.assignments.find(a => a.area === area.area && a.level === 'accountable')?.capability_backed
            return (
              <li key={area.area} className="py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-white/85 text-xs font-medium">{area.label}</p>
                  <p className="text-white/35 text-[10px] leading-snug">{area.question}</p>
                </div>
                <div className="text-right shrink-0">
                  {area.accountable ? (
                    <span className="text-emerald-300/90 font-mono text-[11px]">
                      {area.accountable}
                      {backing === false && <span className="text-amber-400/80" title="No declared capability backs this agent for this area"> ⚠</span>}
                    </span>
                  ) : (
                    <span className="text-white/30 text-[11px]">nobody accountable</span>
                  )}
                  {area.responsible.length > 0 && (
                    <p className="text-white/40 font-mono text-[10px]">+ {area.responsible.join(', ')}</p>
                  )}
                </div>
                {area.accountable && (
                  <button
                    disabled={busy}
                    onClick={() => void write('DELETE', { area: area.area, agent_id: area.accountable })}
                    className="text-white/40 hover:text-white/80 text-[10px] border border-white/10 rounded px-1.5 py-0.5 shrink-0 disabled:opacity-40"
                  >
                    remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}
