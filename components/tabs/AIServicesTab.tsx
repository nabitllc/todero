'use client'
// TOD-933: AI Services page — provider list with status, tokens, cost, refresh
// TOD: kill-fake-infra-greens — every card here used to hardcode
// `status: 'active'`, so a card rendered green whether or not the provider
// was ever reached. Providers now come straight from /api/status's
// `services` map — the same object the Infra tab and the sidebar pill read —
// so this tab cannot disagree with the rest of the app about the same
// service, seconds apart.

import React, { useEffect, useState, useCallback } from 'react'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'

type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown'
interface ServiceReading { status: ServiceState; note: string; checkedAt: string }

interface ProviderCard {
  key: string
  name: string
  icon: string
  status: ServiceState
  detail: string
  cost?: string
  tokens?: string
  checkedAt?: string | null
}

const STATUS_COLOR: Record<ServiceState, { dot: string; badge: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'ok' },
  degraded: { dot: 'bg-amber-500', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'degraded' },
  down: { dot: 'bg-red-500', badge: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'down' },
  // 'unknown' — never checked, or uncheckable on this host — renders grey,
  // the same convention as lib/mc-atoms.tsx's Dot. It must never read as ok.
  unknown: { dot: 'bg-white/20', badge: 'text-white/40 bg-white/5 border-white/10', label: 'unknown' },
}

const PROVIDER_TILES: Array<{ key: string; name: string; icon: string }> = [
  { key: 'claude', name: 'Claude (Anthropic)', icon: '🧠' },
  { key: 'ollama', name: 'Ollama (local)', icon: '🦙' },
  { key: 'supabase', name: 'Supabase', icon: '🗄️' },
  { key: 'vercel', name: 'Vercel', icon: '▲' },
  { key: 'discord', name: 'Discord', icon: '💬' },
  { key: 'telegram', name: 'Telegram', icon: '✈️' },
  { key: 'github', name: 'GitHub', icon: '🐙' },
  { key: 'braveSearch', name: 'Brave Search', icon: '🦁' },
  { key: 'cloudflare', name: 'Cloudflare', icon: '☁️' },
]

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function buildProviders(data: Record<string, unknown> | null): ProviderCard[] {
  if (!data) return []
  const services = (data.services as Record<string, ServiceReading> | undefined) ?? {}
  const usage = data.usage as { totalCost?: number; totalTokens?: number } | null

  return PROVIDER_TILES.map(({ key, name, icon }) => {
    const svc = services[key]
    const status: ServiceState = svc?.status ?? 'unknown'
    const card: ProviderCard = {
      key,
      name,
      icon,
      status,
      detail: svc?.note ?? 'not checked this request',
      checkedAt: svc?.checkedAt ?? null,
    }
    if (key === 'claude' && usage) {
      card.cost = usage.totalCost != null ? `$${usage.totalCost.toFixed(3)} all-time` : undefined
      card.tokens = usage.totalTokens ? `${(usage.totalTokens / 1000).toFixed(0)}K tokens` : undefined
    }
    return card
  })
}

export default function AIServicesTab() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    const r = await fetchJson<Record<string, unknown>>('/api/status', { cache: 'no-store' })
    // A non-ok response (e.g. a 403 with a JSON error body) must not be
    // assigned to `data` — buildProviders() would read an empty `services`
    // map off it and every card would render "unknown / not checked this
    // request" instead of the actual permission error.
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else {
      setError(r.error)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const providers = buildProviders(data)

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-white/30 text-sm">Loading…</div>
  }

  if (error) {
    return (
      <div className="p-4">
        <ApiErrorBanner error={error} onRetry={() => fetchData(true)} />
      </div>
    )
  }

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-white/30 text-sm">/api/status has not answered yet</p>
        <button onClick={() => fetchData(true)} className="text-xs text-blue-400 hover:underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-sm">AI Services</h2>
          <p className="text-white/30 text-xs mt-0.5">Connected providers and usage — from /api/status, same as the Infra tab</p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-white/50 hover:text-white text-xs transition-colors disabled:opacity-50"
        >
          <span className={refreshing ? 'animate-spin inline-block' : ''}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map(p => {
          const sc = STATUS_COLOR[p.status]
          return (
            <div key={p.key} className="rounded-xl border border-white/[0.07] bg-[#0f0f0f] p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{p.icon}</span>
                  <span className="text-white text-xs font-medium">{p.name}</span>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${sc.badge}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${sc.dot}`} />
                  {sc.label}
                </span>
              </div>

              <p className="text-white/50 text-[11px] mb-2">{p.detail}</p>

              <div className="flex items-center justify-between gap-2 text-[10px] text-white/30">
                <div className="flex items-center gap-2">
                  {p.cost && <span>{p.cost}</span>}
                  {p.tokens && <span>{p.tokens}</span>}
                </div>
                <span>checked {fmtTime(p.checkedAt)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
