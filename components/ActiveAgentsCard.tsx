'use client'
// TOD-649: Active Agents Overview card
// Shows live agent activity: who is working, on what issue, and freshness state.

import React, { useState, useEffect, useRef } from 'react'
import { AGENT_DISPLAY } from '@/lib/mc-constants'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'


const STALE_MINUTES = 60   // >60m without activity = stale (amber warning)
const STUCK_MINUTES = 120  // >120m without activity = stuck (red, will be auto-recovered)

interface AgentRow {
  id: string
  name: string
  emoji: string
  status: 'active' | 'idle' | 'scheduled' | string
  isRunning: boolean       // true if agent process detected via ps
  ago: number | null      // minutes since last activity
  nextRunTs: number | null  // epoch ms for next scheduled run
  workStartedAt: number | null  // epoch ms when agent started on current issue
  currentTask: string | null
  issueKey: string | null
  issueTitle: string | null
  issueStatus: string | null
}

function statusDot(status: string, ago: number | null): { color: string; label: string } {
  if (status === 'active') {
    if (ago !== null && ago > STUCK_MINUTES) return { color: '#ef4444', label: 'stuck' }
    if (ago !== null && ago > STALE_MINUTES) return { color: '#f59e0b', label: 'stale' }
    return { color: '#22c55e', label: 'active' }
  }
  if (status === 'scheduled') return { color: '#f59e0b', label: 'scheduled' }
  if (ago === null || ago > STUCK_MINUTES) return { color: '#ef4444', label: 'stuck' }
  if (ago > STALE_MINUTES) return { color: '#f59e0b', label: 'stale' }
  return { color: '#6b7280', label: 'idle' }
}

function fmtAgeShort(ago: number | null): string {
  if (ago === null) return '?'
  if (ago < 60) return `${ago}m`
  const h = Math.floor(ago / 60)
  const m = ago % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtAgo(ago: number | null): string {
  if (ago === null) return 'never'
  if (ago < 1) return 'just now'
  if (ago < 60) return `${ago}m ago`
  const h = Math.floor(ago / 60)
  const m = ago % 60
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`
}

// WorkTimer: counts UP from when agent started working on current issue
// Resets when issue/status changes (because workStartedAt changes)
const WorkTimer = React.memo(function WorkTimer({ startedAt }: { startedAt: number }) {
  const stableStart = useRef(startedAt)
  // Only update if it changed significantly (new issue/status)
  if (Math.abs(startedAt - stableStart.current) > 5000) {
    stableStart.current = startedAt
  }
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const diff = Math.max(0, Math.floor((now - stableStart.current) / 1000))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return <>{parts.join(' ')}</>
})

const Countdown = React.memo(function Countdown({ targetTs }: { targetTs: number }) {
  // Use a stable target ref that only updates if the target changes by > 1 minute.
  // This prevents countdown resets when the parent re-renders every 30s.
  const stableTarget = useRef(targetTs)
  if (Math.abs(targetTs - stableTarget.current) > 60000) {
    stableTarget.current = targetTs
  }

  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])
  const diff = Math.max(0, Math.floor((stableTarget.current - now) / 1000))
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (h === 0) parts.push(`${s}s`) // only show seconds when under 1h
  return <>{diff === 0 ? 'waking up...' : parts.join(' ')}</>
})

export default function ActiveAgentsCard({ agentCurrentTask }: { agentCurrentTask?: Record<string, string> }) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  // TOD-654: "No active agents right now." was rendered over a refused /api/agents
  // just as readily as over a genuinely idle fleet. Keep the failure and show it.
  const [error, setError] = useState<ApiError | null>(null)

  const fetchData = async () => {
    try {
      // Fetch agents list for status + ago
      const [agentsRes, issuesRes] = await Promise.all([
        fetch('/api/agents'),
        fetch(
          dbUrl(`issues?status=eq.in_progress&select=task_key,title,status,assignee,worked_by&limit=30`),
          { headers: dbRestHeaders() }
        ),
      ])

      // /api/agents answers with an envelope { agents, configured, error } and
      // uses 503 on an unconfigured host — the roster still ships in the body,
      // so parse it regardless of status rather than silently showing nothing.
      const agentsBody = await agentsRes.json().catch(() => null)
      const agentsData: any[] = Array.isArray(agentsBody)
        ? agentsBody
        : Array.isArray(agentsBody?.agents) ? agentsBody.agents : []

      // A non-ok response that still carried a roster (the 503 unconfigured-host
      // envelope) is renderable. A non-ok response with no roster is not — that
      // is a refusal, and it must not come out looking like an idle fleet.
      if (!agentsRes.ok && agentsData.length === 0) {
        setError({
          status: agentsRes.status,
          endpoint: '/api/agents',
          message: typeof agentsBody?.error === 'string' ? agentsBody.error
            : typeof agentsBody?.message === 'string' ? agentsBody.message
            : agentsRes.statusText || 'request failed',
        })
        setAgents([])
        return
      }
      if (!issuesRes.ok) {
        setError(await readApiError(issuesRes, '/api/db/issues'))
        setAgents([])
        return
      }
      setError(null)
      const issuesData: any[] = await issuesRes.json()

      // Build lookup: assignee → active issue
      const issueByAssignee: Record<string, { key: string; title: string; status: string }> = {}
      for (const iss of issuesData) {
        const owner = iss.worked_by || iss.assignee
        if (owner) {
          issueByAssignee[owner] = {
            key: iss.task_key ?? '?',
            title: iss.title ?? '',
            status: iss.status ?? '',
          }
        }
      }

      // Build rows — show only active (running/in_progress) or scheduled agents
      const rows: AgentRow[] = agentsData
        .filter((a: any) => {
          return a.status === 'active' || a.status === 'scheduled'
        })
        .map((a: any) => {
          const display = AGENT_DISPLAY[a.id] ?? { name: a.name ?? a.id, emoji: '🤖' }
          const issue = issueByAssignee[a.id] ?? null
          return {
            id: a.id,
            name: display.name ?? a.id,
            emoji: display.emoji ?? '🤖',
            status: a.status,
            isRunning: !!a.isRunning,
            ago: a.ago,
            nextRunTs: a.nextRunTs ?? null,
            workStartedAt: a.workStartedAt ?? null,
            currentTask: agentCurrentTask?.[a.id] ?? null,
            issueKey: issue?.key ?? null,
            issueTitle: issue?.title ?? null,
            issueStatus: issue?.status ?? null,
          }
        })
        .sort((a, b) => {
          // Active first, then scheduled, then by recency
          const rank = (s: string) => s === 'active' ? 0 : s === 'scheduled' ? 1 : 2
          if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status)
          return (a.ago ?? 9999) - (b.ago ?? 9999)
        })

      setAgents(rows)
    } catch (e) {
      setError({
        status: 0,
        endpoint: '/api/agents',
        message: e instanceof Error ? e.message : 'could not reach the server',
      })
      setAgents([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const iv = setInterval(fetchData, 30_000) // refresh every 30s
    return () => clearInterval(iv)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">🤖</span>
          <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Active Agents</span>
        </div>
        <div className="text-white/20 text-xs">Loading…</div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Active Agents</span>
        </div>
        <span className="text-[10px] text-white/20">↻ 30s</span>
      </div>

      {error ? (
        <ApiErrorBanner error={error} onRetry={() => { setLoading(true); fetchData() }} />
      ) : agents.length === 0 ? (
        <div className="text-white/20 text-xs py-2">No active agents right now.</div>
      ) : (
        <div className="space-y-1">
          {agents.map(agent => {
            const dot = statusDot(agent.status, agent.ago)
            const ageMin = agent.ago
            const isStuck = ageMin !== null && ageMin > STUCK_MINUTES
            const isStale = !isStuck && ageMin !== null && ageMin > STALE_MINUTES
            return (
              <div key={agent.id}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 bg-white/[0.03] border border-white/[0.06]">
                {/* Status dot — pulses when agent process is actually running */}
                <span
                  className={`block w-2 h-2 rounded-full shrink-0${agent.isRunning ? ' animate-pulse' : ''}`}
                  style={{ background: dot.color, boxShadow: agent.status === 'active' ? `0 0 6px ${dot.color}66` : undefined }}
                />
                {/* Agent name */}
                <span className="text-[11px] font-medium text-white/80 shrink-0">{agent.emoji} {agent.name}</span>
                {isStuck && (
                  <span
                    className="text-[8px] px-1 py-0.5 rounded bg-red-900/40 text-red-400 font-medium shrink-0"
                    title="No activity for over 2h — will be auto-recovered"
                  >
                    🛑 stuck {fmtAgeShort(ageMin)}
                  </span>
                )}
                {isStale && (
                  <span
                    className="text-[8px] px-1 py-0.5 rounded bg-amber-900/30 text-amber-400 font-medium shrink-0"
                    title="No activity for over 1h"
                  >
                    ⚠️ stale {fmtAgeShort(ageMin)}
                  </span>
                )}
                {/* Current work or scheduled info */}
                <div className="flex-1 min-w-0 flex items-center gap-1">
                  {agent.issueKey ? (
                    <>
                      <span className="text-[9px] font-mono text-white/40 shrink-0">{agent.issueKey}</span>
                      <span className="text-[9px] text-white/40 truncate">{agent.issueTitle}</span>
                      {agent.issueStatus && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-white/10 text-white/25 font-mono shrink-0">
                          {agent.issueStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </>
                  ) : agent.status === 'scheduled' && agent.nextRunTs ? (
                    <span className="text-[9px] text-amber-500/60"><Countdown targetTs={agent.nextRunTs} /></span>
                  ) : null}
                </div>
                {/* Work timer - shows time since agent started on current issue */}
                {agent.workStartedAt && agent.issueKey && (
                  <span className="text-[9px] font-mono text-emerald-500/70 shrink-0" title="Time spent on this issue">
                    <WorkTimer startedAt={agent.workStartedAt} />
                  </span>
                )}
                {/* Last active - right aligned */}
                <span className="text-[8px] text-white/15 shrink-0">{fmtAgo(agent.ago)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
