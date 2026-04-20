'use client'
// TOD-933: AI Services page — provider list with status, tokens, cost, refresh

import React, { useEffect, useState, useCallback } from 'react'

interface ProviderCard {
  name: string
  icon: string
  status: 'active' | 'inactive' | 'error'
  detail: string
  cost?: string
  tokens?: string
  lastSynced?: string
}

const STATUS_COLOR = {
  active: { dot: 'bg-emerald-500', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  inactive: { dot: 'bg-white/20', badge: 'text-white/40 bg-white/5 border-white/10' },
  error: { dot: 'bg-red-500', badge: 'text-red-400 bg-red-500/10 border-red-500/20' },
}

function fmtBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function buildProviders(data: Record<string, unknown> | null): ProviderCard[] {
  if (!data) return []

  const or = data.openrouter as Record<string, unknown> | null
  const n8n = data.n8n as Record<string, unknown> | null
  const supa = data.supabase as Record<string, unknown> | null
  const claude = data.claude as Record<string, unknown> | null
  const vercel = data.vercel as Record<string, unknown> | null
  const discord = data.discord as Record<string, unknown> | null

  return [
    {
      name: 'Claude (Anthropic)',
      icon: '🧠',
      status: 'active',
      detail: String(claude?.plan ?? 'Max $200/mo'),
      cost: claude?.todayCost != null ? `$${(claude.todayCost as number).toFixed(3)} today` : undefined,
      tokens: claude?.totalTokens ? `${((claude.totalTokens as number) / 1000).toFixed(0)}K tokens` : undefined,
      lastSynced: claude?.lastChecked as string,
    },
    {
      name: 'OpenRouter',
      icon: '🔀',
      status: or?.balance != null ? ((or.balance as number) < 1 ? 'error' : 'active') : 'inactive',
      detail: or?.balance != null
        ? `$${(or.balance as number).toFixed(2)} remaining / $${(or.limit as number ?? 10).toFixed(0)} limit`
        : 'No data',
      cost: or?.used != null ? `$${(or.used as number).toFixed(3)} used` : undefined,
      lastSynced: or?.lastChecked as string,
    },
    {
      name: 'Supabase',
      icon: '🗄️',
      status: supa?.dbBytes != null ? 'active' : 'inactive',
      detail: supa?.dbBytes != null
        ? `${fmtBytes(supa.dbBytes as number)} / ${fmtBytes((supa.dbLimitBytes as number) ?? 500 * 1024 * 1024)} (${String(supa.plan ?? 'Free')})`
        : String(supa?.plan ?? 'Free Tier'),
      lastSynced: supa?.lastChecked as string,
    },
    {
      name: 'n8n',
      icon: '⚡',
      status: (n8n?.running as boolean) ? 'active' : 'error',
      detail: (n8n?.running as boolean)
        ? `${n8n?.activeWorkflows ?? 0} / ${n8n?.totalWorkflows ?? 0} workflows active · Self-hosted`
        : 'Offline',
      lastSynced: n8n?.lastChecked as string,
    },
    {
      name: 'Vercel',
      icon: '▲',
      status: 'active',
      detail: `${String(vercel?.plan ?? 'Pro')} · renews ${String(vercel?.renewsAt ?? '?')}`,
      lastSynced: vercel?.lastChecked as string,
    },
    {
      name: 'Discord',
      icon: '💬',
      status: (discord?.connected as boolean) ? 'active' : 'error',
      detail: (discord?.connected as boolean) ? 'Kemuni Server · connected' : 'Disconnected',
      lastSynced: discord?.lastChecked as string,
    },
  ]
}

export default function AIServicesTab() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/settings/usage')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const providers = buildProviders(data)

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-white/30 text-sm">Loading…</div>
  }

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3">
        <p className="text-white/30 text-sm">No providers configured</p>
        <button className="text-xs text-blue-400 hover:underline">→ Go to Settings</button>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-sm">AI Services</h2>
          <p className="text-white/30 text-xs mt-0.5">Connected providers and usage</p>
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
            <div key={p.name} className="rounded-xl border border-white/[0.07] bg-[#0f0f0f] p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">{p.icon}</span>
                  <span className="text-white text-xs font-medium">{p.name}</span>
                </div>
                <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${sc.badge}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${sc.dot}`} />
                  {p.status}
                </span>
              </div>

              <p className="text-white/50 text-[11px] mb-2">{p.detail}</p>

              <div className="flex items-center justify-between gap-2 text-[10px] text-white/30">
                <div className="flex items-center gap-2">
                  {p.cost && <span>{p.cost}</span>}
                  {p.tokens && <span>{p.tokens}</span>}
                </div>
                <span>synced {fmtTime(p.lastSynced)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
