'use client'

// TOD-2415 — Settings -> Automations: the hour bolts open and close.
//
// Owner: "bolts should start/finish at 5am local time by default. somewhere in
// settings allow to change that." The default lives in lib/bolt-time.ts; this
// card is the "change that" half.
//
// The card contract (docs/rebuild/pieces/pieces6/cards-and-identity.md): one
// question, one number that matters, the query that produced it, one action,
// and an empty state that names its subject rather than reading as breakage.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'
import { DEFAULT_BOLT_START_HOUR, boltWindow, formatRemaining, parseStartHour } from '@/lib/bolt-time'

interface Props {
  /** Hub name. The id is resolved from /api/businesses here rather than
   *  threaded through app/page.tsx, which fetches that list but keeps no
   *  rows in state. One fetch, owned by the one component that needs it. */
  hubName: string | null
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** "5am", "12pm", "13:00" -> a label an operator reads, not a raw integer. */
function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export default function BoltScheduleCard({ hubName }: Props) {
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [hour, setHour] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** Re-render each minute so the "next bolt opens in" figure stays live. */
  const [, tick] = useState(0)

  const source = `GET /api/hub-settings?business_id=${businessId ?? '<none>'} · key bolt_start_hour`

  const load = useCallback(async () => {
    if (!businessId) return
    try {
      const res = await fetch(`/api/hub-settings?business_id=${encodeURIComponent(businessId)}`)
      if (!res.ok) {
        setError(await readApiError(res, '/api/hub-settings'))
        setLoaded(true)
        return
      }
      const body = await res.json()
      setError(null)
      // No row is not an error: it means the default is in force. Show the
      // default and say so, rather than rendering an empty control.
      setHour(parseStartHour(body?.settings?.bolt_start_hour) ?? DEFAULT_BOLT_START_HOUR)
      setLoaded(true)
    } catch (e) {
      setError({ status: 0, endpoint: '/api/hub-settings', message: e instanceof Error ? e.message : 'could not reach the server' })
      setLoaded(true)
    }
  }, [businessId])

  useEffect(() => {
    if (!hubName) return
    let live = true
    ;(async () => {
      try {
        const res = await fetch('/api/businesses')
        if (!res.ok) { if (live) { setError(await readApiError(res, '/api/businesses')); setLoaded(true) } return }
        const rows = (await res.json()) as { id?: string; name?: string }[]
        if (!live) return
        setBusinessId(rows.find(b => b.name === hubName)?.id ?? null)
      } catch {
        if (live) { setBusinessId(null); setLoaded(true) }
      }
    })()
    return () => { live = false }
  }, [hubName])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  async function save(next: number) {
    if (!businessId) return
    setSaving(true)
    try {
      const res = await fetch('/api/hub-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, key: 'bolt_start_hour', value: next }),
      })
      if (!res.ok) { setError(await readApiError(res, '/api/hub-settings')); return }
      setError(null)
      setHour(next)
    } finally {
      setSaving(false)
    }
  }

  if (!businessId) {
    return (
      <Card
        id="settings-bolt-schedule"
        title="Bolt schedule"
        source={source}
        empty={{ active: true, message: 'No hub selected, so there is no schedule to show yet.' }}
      />
    )
  }
  if (error) {
    return <Card id="settings-bolt-schedule" title="Bolt schedule" source={source}><ApiErrorBanner error={error} onRetry={load} /></Card>
  }
  if (!loaded || hour === null) {
    return <Card id="settings-bolt-schedule" title="Bolt schedule" source={source}><span className="text-white/40 text-sm">Loading…</span></Card>
  }

  // The number that matters: when the next bolt opens. Derived from the SAME
  // boltWindow the writer uses, so this card cannot disagree with what
  // /api/sprint-start will actually stamp.
  const { end } = boltWindow(hour)
  const opensInMs = new Date(end).getTime() - Date.now()

  return (
    <Card
      id="settings-bolt-schedule"
      title="Bolt schedule"
      source={source}
      metric={{ value: formatRemaining(opensInMs), label: 'until next bolt' }}
    >
      <div className="space-y-3">
        <p className="text-white/50 text-xs leading-relaxed">
          Bolts for <span className="text-white/80">{hubName ?? 'this hub'}</span> open and close at{' '}
          <span className="text-white/80 font-mono">{hourLabel(hour)}</span> local time, and run for 24 hours.
          {hour === DEFAULT_BOLT_START_HOUR && <span className="text-white/30"> (default)</span>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {HOURS.map(h => (
            <button
              key={h}
              disabled={saving}
              onClick={() => void save(h)}
              aria-pressed={h === hour}
              className={[
                'text-[11px] px-2 py-1 rounded-md border font-mono transition-all disabled:opacity-40',
                h === hour
                  ? 'bg-white text-[#0a0a0a] border-white'
                  : 'bg-transparent text-white/50 border-white/10 hover:border-white/25 hover:text-white/80',
              ].join(' ')}
            >
              {hourLabel(h)}
            </button>
          ))}
        </div>
        <p className="text-white/25 text-[10px] leading-relaxed">
          Changing this moves the boundary for the NEXT bolt. A bolt already open keeps the window it was
          stamped with — its countdown is real and does not move under it.
        </p>
      </div>
    </Card>
  )
}
