'use client'
import React, { useEffect, useState, useCallback } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, readApiError, type ApiError } from '@/hooks/useApiData'
import { RefreshCw } from 'lucide-react'
import { StatusDot } from '@/components/ui/StatusDot'
// TOD: kill-fake-infra-greens — imports the client-safe constants module, not
// lib/theme.ts, which pulls in lib/db.ts's postgres adapter (Node-only `pg`,
// needs `fs`) and broke the client bundle for every route on this host.
// one-clock (pieces6): this file's local timeAgo is deleted. It capped at
// minutes, so a check made 26 hours ago read "1560m ago"; and it said "just
// now" under 10s, which was a seventh spelling of a short age.
// See docs/rebuild/pieces/pieces6/one-clock.md.
import { formatAgo } from '@/lib/time'
import { THEMES, THEME_IDS } from '@/lib/theme-constants'
import type { ThemeId } from '@/lib/theme-constants'
import CostBreakdownTable from '@/components/CostBreakdownTable'

// TOD (pieces7/one-discord-sender-and-honest-db-usage): was `supabase:
// { dbBytes, dbLimitBytes: number, plan: string }` — a vendor name, an
// invented 500MB "Free Tier" denominator, and a plan tier applied
// unconditionally, regardless of which database this install actually runs.
// `dbLimitBytes`/`plan` are now nullable: null means genuinely unknown, not
// "assume Supabase's free tier". `provider` is read live from lib/db.ts.
interface UsageData {
  database: { provider: string; dbBytes: number | null; dbLimitBytes: number | null; plan: string | null; lastChecked: string }
  // Owner directive: no hosted LLM gateway, no cloud LLM. This is a live read of
  // ${LLM_BASE_URL}/models made fresh for the request — baseUrl/models come
  // straight off that response, never a hardcoded roster or a fabricated plan.
  localLlm: { baseUrl: string; models: string[]; ok: boolean; error: string | null; lastChecked: string }
  cloudflare: { kaos: { up: boolean; lastChecked: string } }
  discord: { connected: boolean; lastChecked: string }
  // TOD: kill-fake-infra-greens — no `plan`: this server cannot read the
  // Claude CLI's local OAuth session, so there is nothing to assert. Token
  // totals are null, not zero, when the sum never ran.
  claude: { totalTokens: number | null; totalCost: number | null; todayCost: number | null; lastChecked: string }
  // TOD: kill-fake-infra-greens — Vercel billing has no probe on this host;
  // null means "not tracked", not "inactive". See services.vercel in
  // /api/status for the real deployment-API reading.
  vercel: null
}

/** Human label for a provider key from lib/db.ts's DB_PROVIDER — never a guess about a plan. */
const DB_PROVIDER_LABEL: Record<string, string> = {
  sqlite: 'SQLite',
  postgres: 'Postgres',
  supabase: 'Supabase',
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
      {lastChecked && <div className="text-[10px] text-white/20 mt-2">{formatAgo(lastChecked)}</div>}
    </div>
  )
}

export default function SettingsTab() {
  const [data, setData] = useState<UsageData | null>(null)
  // TOD-654: the reason the usage load failed, verbatim from the server.
  const [usageError, setUsageError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<ThemeId>('dark')
  const [themeSaving, setThemeSaving] = useState(false)

  const fetchUsage = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    const endpoint = '/api/settings/usage'
    try {
      const res = await fetch(endpoint)
      if (res.ok) {
        setData(await res.json())
        setUsageError(null)
      } else {
        setUsageError(await readApiError(res, endpoint))
        setData(null)
      }
    } catch (e) {
      setUsageError({
        status: 0,
        endpoint,
        message: e instanceof Error ? e.message : 'could not reach the server',
      })
      setData(null)
    }
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    fetchUsage()
    const iv = setInterval(() => fetchUsage(), 60_000)
    return () => clearInterval(iv)
  }, [fetchUsage])

  useEffect(() => {
    fetchJson<{ themeId?: string }>('/api/theme').then(r => {
      if (r.ok && r.data?.themeId) setCurrentTheme(r.data.themeId as ThemeId)
    })
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
        {usageError ? (
          <div className="w-full max-w-xl px-4">
            <ApiErrorBanner error={usageError} onRetry={() => { setLoading(true); fetchUsage() }} />
          </div>
        ) : (
          <>
            <div className="text-white/40 text-sm">Failed to load usage data</div>
            <button onClick={() => { setLoading(true); fetchUsage() }}
              className="text-xs text-white/50 hover:text-white transition-colors">Retry</button>
          </>
        )}
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

  // TOD (pieces7/one-discord-sender-and-honest-db-usage): a percentage
  // requires BOTH a real byte count and a real limit — this install's
  // provider may have no known limit at all (sqlite: a local file, no vendor
  // ceiling), and computing a percentage against a null denominator would be
  // a fabricated percentage the same way the old hardcoded 500MB was.
  const dbPct = data.database.dbBytes != null && data.database.dbLimitBytes != null
    ? (data.database.dbBytes / data.database.dbLimitBytes) * 100
    : null
  const dbProviderLabel = DB_PROVIDER_LABEL[data.database.provider] ?? data.database.provider
  const dbPlanLabel = data.database.plan
    ?? (data.database.provider === 'sqlite'
      ? 'Local file — no vendor size limit'
      : 'No plan/limit known for this database')

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
        {/* Database — TOD (pieces7/one-discord-sender-and-honest-db-usage):
            was hardcoded "Supabase" / "Free Tier" / 500MB regardless of which
            database this install actually runs. Name, size and limit are now
            all read from what /api/settings/usage actually measured; an
            absent limit renders as "no vendor size limit" rather than a
            fabricated percentage against an invented denominator. */}
        <ServiceCard emoji="🗄️" name={dbProviderLabel} plan={dbPlanLabel}
          status={dbPct != null ? (dbPct >= 90 ? 'error' : dbPct >= 70 ? 'warning' : 'active') : 'idle'}
          statusLabel={
            dbPct != null ? `${dbPct.toFixed(0)}% used`
              : data.database.dbBytes != null ? 'No size limit'
              : 'Unknown'
          }
          lastChecked={data.database.lastChecked}>
          {data.database.dbBytes != null ? (
            <>
              <div className="text-xs text-white/60">
                {formatBytes(data.database.dbBytes)}
                {data.database.dbLimitBytes != null && <> / {formatBytes(data.database.dbLimitBytes)}</>}
              </div>
              {data.database.dbLimitBytes != null && (
                <UsageBar value={data.database.dbBytes} max={data.database.dbLimitBytes} label="Database" />
              )}
            </>
          ) : (
            <div className="text-xs text-white/30">DB size unavailable</div>
          )}
        </ServiceCard>

        {/* Claude — TOD: kill-fake-infra-greens: no plan tier is asserted (this
            server cannot see the CLI's local OAuth session), and status
            reflects whether any usage was actually summed this request. */}
        <ServiceCard emoji="🧠" name="Claude" plan="Session state is local to the CLI — not visible to this server"
          status={data.claude.totalTokens != null ? 'active' : 'idle'}
          statusLabel={data.claude.totalTokens != null ? 'Tracked' : 'Not tracked'}
          lastChecked={data.claude.lastChecked}>
          {data.claude.totalTokens != null ? (
            <>
              <div className="text-xs text-white/60">{formatTokens(data.claude.totalTokens)} tokens tracked</div>
              {(data.claude.todayCost ?? 0) > 0 && <div className="text-xs text-white/40 mt-0.5">Today: ${(data.claude.todayCost ?? 0).toFixed(2)}</div>}
            </>
          ) : (
            <div className="text-xs text-white/30">No agent_runs data on this host</div>
          )}
          <a href="https://claude.ai/settings" target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-blue-400/70 hover:text-blue-400 mt-1 inline-block">claude.ai/settings</a>
        </ServiceCard>

        {/* Local LLM — owner directive: no hosted LLM gateway, no cloud LLM. Every
            field below is a live read of ${LLM_BASE_URL}/models made for
            this request. On failure there is nothing measured to caption or
            timestamp — no plan string, no "checked Ns ago" — just the URL
            and the reason it didn't answer. */}
        <ServiceCard emoji="🖥️" name="Local LLM"
          plan={data.localLlm.ok ? data.localLlm.baseUrl : ''}
          status={data.localLlm.ok ? 'active' : 'error'}
          statusLabel={data.localLlm.ok ? `${data.localLlm.models.length} model${data.localLlm.models.length === 1 ? '' : 's'}` : 'Unreachable'}
          lastChecked={data.localLlm.ok ? data.localLlm.lastChecked : undefined}>
          {data.localLlm.ok ? (
            <div className="text-xs text-white/60">{data.localLlm.models.length > 0 ? data.localLlm.models.join(', ') : 'reachable but no models pulled'}</div>
          ) : (
            <div className="text-xs text-red-400/80">{data.localLlm.error}</div>
          )}
        </ServiceCard>

        {/* Vercel — TOD: kill-fake-infra-greens: this route has no Vercel
            billing probe, so nothing here is asserted as active. See the
            Vercel tile on the Infra tab for the real deployment-API reading. */}
        <ServiceCard emoji="▲" name="Vercel" plan="No billing probe on this host"
          status="idle" statusLabel="Not tracked here"
          lastChecked={undefined}>
          <div className="text-xs text-white/30">See the Vercel tile on the Infra tab for the live deployment check.</div>
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
