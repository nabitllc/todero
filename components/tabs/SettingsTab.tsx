'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { StatusDot } from '@/components/ui/StatusDot'
import { THEMES, THEME_IDS } from '@/lib/theme'
import type { ThemeId } from '@/lib/theme'
import CostBreakdownTable from '@/components/CostBreakdownTable'

interface UsageData {
  supabase: { dbBytes: number | null; dbLimitBytes: number; plan: string; lastChecked: string }
  openrouter: { balance: number | null; limit: number | null; used: number | null; isFreeTier: boolean; lastChecked: string }
  cloudflare: { kaos: { up: boolean; lastChecked: string } }
  discord: { connected: boolean; lastChecked: string }
  claude: { totalTokens: number; todayCost: number; plan: string; lastChecked: string }
  vercel: { plan: string; seats: number; renewsAt: string; lastChecked: string }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}K`
  return String(t)
}

function barColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#22c55e'
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  return `${Math.floor(sec / 60)}m ago`
}

function UsageBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-white/40 mb-1">
        <span>{label}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/10">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: barColor(pct) }} />
      </div>
    </div>
  )
}

function ServiceCard({ emoji, name, plan, status, statusLabel, children, lastChecked }: {
  emoji: string; name: string; plan: string
  status: 'active' | 'warning' | 'error' | 'idle'
  statusLabel?: string
  children?: React.ReactNode
  lastChecked?: string
}) {
  return (
    <div className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">{emoji}</span>
          <span className="text-sm font-medium text-white">{name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {statusLabel && <span className="text-[10px] text-white/40">{statusLabel}</span>}
          <StatusDot variant={status} />
        </div>
      </div>
      <div className="text-xs text-white/40 mb-2">{plan}</div>
      {children}
      {lastChecked && <div className="text-[10px] text-white/20 mt-2">{timeAgo(lastChecked)}</div>}
    </div>
  )
}

export default function SettingsTab() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('dark')
  const [themeSaving, setThemeSaving] = useState(false)

  const fetchUsage = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/settings/usage')
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    fetchUsage()
    const iv = setInterval(() => fetchUsage(), 60_000)
    return () => clearInterval(iv)
  }, [fetchUsage])

  useEffect(() => {
    fetch('/api/theme').then(r => r.json()).then(d => { if (d.themeId) setCurrentTheme(d.themeId) }).catch(() => {})
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-white/30 text-sm">Loading usage data...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="text-white/40 text-sm">Failed to load usage data</div>
        <button onClick={() => { setLoading(true); fetchUsage() }}
          className="text-xs text-white/50 hover:text-white transition-colors">Retry</button>
      </div>
    )
  }

  const handleThemeChange = async (themeId: ThemeId) => {
    setCurrentTheme(themeId)
    setThemeSaving(true)
    try {
      await fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ themeId }) })
      // Apply theme to body
      const t = THEMES[themeId]
      document.body.style.background = t.bg
      document.documentElement.style.setProperty('--mc-bg', t.bg)
      document.documentElement.style.setProperty('--mc-surface', t.surface)
    } catch { /* ignore */ }
    setThemeSaving(false)
  }

  const dbPct = data.supabase.dbBytes != null ? (data.supabase.dbBytes / data.supabase.dbLimitBytes) * 100 : null

  return (
    <div>
      {/* INF-223: Theme selector */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-white mb-1">Appearance</h2>
        <p className="text-xs text-white/30 mb-3">Choose a color theme for Todero</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {THEME_IDS.map(tid => {
            const t = THEMES[tid]
            const active = tid === currentTheme
            return (
              <button
                key={tid}
                onClick={() => handleThemeChange(tid)}
                disabled={themeSaving}
                className={'rounded-xl p-3 border transition-all text-left ' +
                  (active ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-white/10 hover:border-white/20')}
                style={{ background: t.surface }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 rounded-full" style={{ background: t.accent }} />
                  <span className="text-xs font-medium" style={{ color: t.textPrimary }}>{t.label}</span>
                </div>
                <div className="flex gap-1">
                  <div className="w-6 h-3 rounded" style={{ background: t.bg }} />
                  <div className="w-6 h-3 rounded" style={{ background: t.surface }} />
                  <div className="w-6 h-3 rounded" style={{ background: t.accent }} />
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-white">Usage & Limits</h2>
          <p className="text-xs text-white/30 mt-0.5">Service consumption across all integrations</p>
        </div>
        <button onClick={() => fetchUsage(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/70 hover:bg-white/10 transition-all disabled:opacity-50">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Supabase */}
        <ServiceCard emoji="🗄️" name="Supabase" plan={data.supabase.plan}
          status={dbPct != null ? (dbPct >= 90 ? 'error' : dbPct >= 70 ? 'warning' : 'active') : 'idle'}
          statusLabel={dbPct != null ? `${dbPct.toFixed(0)}% used` : 'Unknown'}
          lastChecked={data.supabase.lastChecked}>
          {data.supabase.dbBytes != null ? (
            <>
              <div className="text-xs text-white/60">{formatBytes(data.supabase.dbBytes)} / {formatBytes(data.supabase.dbLimitBytes)}</div>
              <UsageBar value={data.supabase.dbBytes} max={data.supabase.dbLimitBytes} label="Database" />
            </>
          ) : (
            <div className="text-xs text-white/30">DB size unavailable</div>
          )}
        </ServiceCard>

        {/* Claude */}
        <ServiceCard emoji="🧠" name="Claude" plan={data.claude.plan}
          status="active" statusLabel="Active"
          lastChecked={data.claude.lastChecked}>
          <div className="text-xs text-white/60">{formatTokens(data.claude.totalTokens)} tokens tracked</div>
          {data.claude.todayCost > 0 && <div className="text-xs text-white/40 mt-0.5">Today: ${data.claude.todayCost.toFixed(2)}</div>}
          <a href="https://claude.ai/settings" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-400/70 hover:text-blue-400 mt-1 inline-block">claude.ai/settings</a>
        </ServiceCard>

        {/* OpenRouter */}
        <ServiceCard emoji="🌐" name="OpenRouter"
          plan={data.openrouter.isFreeTier ? 'Free Tier' : 'Pay-as-you-go'}
          status={data.openrouter.balance != null ? (data.openrouter.balance <= 1 ? 'warning' : 'active') : 'idle'}
          statusLabel={data.openrouter.balance != null ? `$${data.openrouter.balance.toFixed(2)} remaining` : 'Unknown'}
          lastChecked={data.openrouter.lastChecked}>
          {data.openrouter.balance != null && data.openrouter.limit != null ? (
            <>
              <div className="text-xs text-white/60">${data.openrouter.used?.toFixed(2) ?? '0'} used / ${data.openrouter.limit.toFixed(2)} limit</div>
              <UsageBar value={data.openrouter.used ?? 0} max={data.openrouter.limit} label="Credits" />
            </>
          ) : (
            <div className="text-xs text-white/60">{data.openrouter.balance != null ? `$${data.openrouter.balance.toFixed(2)} remaining` : 'Balance unavailable'}</div>
          )}
        </ServiceCard>

        {/* Vercel */}
        <ServiceCard emoji="▲" name="Vercel" plan={data.vercel.plan}
          status="active" statusLabel="Active"
          lastChecked={data.vercel.lastChecked}>
          <div className="text-xs text-white/60">{data.vercel.seats} seat · Renews {data.vercel.renewsAt}</div>
          <a href="https://vercel.com/account" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-400/70 hover:text-blue-400 mt-1 inline-block">vercel.com/account</a>
        </ServiceCard>

        {/* Cloudflare */}
        <ServiceCard emoji="☁️" name="Cloudflare Tunnels" plan="Free Tier"
          status={data.cloudflare.kaos.up ? 'active' : 'error'}
          statusLabel={data.cloudflare.kaos.up ? 'Up' : 'Down'}
          lastChecked={data.cloudflare.kaos.lastChecked}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <StatusDot variant={data.cloudflare.kaos.up ? 'active' : 'error'} sm />
              <span className="text-white/60">kaos.nabit.work</span>
            </div>
          </div>
        </ServiceCard>

        {/* Discord */}
        <ServiceCard emoji="💬" name="Discord Bot" plan="Bot"
          status={data.discord.connected ? 'active' : 'error'}
          statusLabel={data.discord.connected ? 'Connected' : 'Disconnected'}
          lastChecked={data.discord.lastChecked}>
          <div className="text-xs text-white/60">{data.discord.connected ? 'Bot is online and responding' : 'Bot is offline or token missing'}</div>
        </ServiceCard>
      </div>

      {/* Cost Breakdown */}
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-white mb-1">Cost Breakdown</h2>
        <p className="text-xs text-white/30 mb-4">Token usage and estimated cost per project and agent</p>
        <CostBreakdownTable />
      </div>
    </div>
  )
}
