'use client'
// TOD-649: Active Agents Overview card
// Shows live agent activity: who is working, on what issue, and freshness state.

import React, { useState, useEffect } from 'react'
import { AGENT_DISPLAY } from '@/lib/mc-constants'

const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

const STALE_MINUTES = 60 // >60 min without activity = stale

interface AgentRow {
  id: string
  name: string
  emoji: string
  status: 'active' | 'idle' | 'scheduled' | string
  ago: number | null      // minutes since last activity
  nextRun: string | null  // for scheduled agents
  currentTask: string | null
  issueKey: string | null
  issueTitle: string | null
  issueStatus: string | null
}

function statusDot(status: string, ago: number | null): { color: string; label: string } {
  if (status === 'active') return { color: '#22c55e', label: 'active' }
  if (status === 'scheduled') return { color: '#f59e0b', label: 'scheduled' }
  if (ago === null || ago > STALE_MINUTES) return { color: '#6b7280', label: 'stale' }
  return { color: '#6b7280', label: 'idle' }
}

function fmtAgo(ago: number | null): string {
  if (ago === null) return 'never'
  if (ago < 1) return 'just now'
  if (ago < 60) return `${ago}m ago`
  const h = Math.floor(ago / 60)
  const m = ago % 60
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`
}

export default function ActiveAgentsCard({ agentCurrentTask }: { agentCurrentTask?: Record<string, string> }) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    try {
      // Fetch agents list for status + ago
      const [agentsRes, issuesRes] = await Promise.all([
        fetch('/api/agents'),
        fetch(
          `${SUPA}/rest/v1/issues?status=eq.in_progress&select=task_key,title,status,assignee,worked_by&limit=30`,
          { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
        ),
      ])

      const agentsData: any[] = agentsRes.ok ? await agentsRes.json() : []
      const issuesData: any[] = issuesRes.ok ? await issuesRes.json() : []

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

      // Build rows — show active/scheduled + recently-active idle agents (ago < 60)
      const rows: AgentRow[] = agentsData
        .filter((a: any) => {
          const isActiveish = a.status === 'active' || a.status === 'scheduled'
          const recentIdle = a.status === 'idle' && a.ago !== null && a.ago < 30
          return isActiveish || recentIdle
        })
        .map((a: any) => {
          const display = AGENT_DISPLAY[a.id] ?? { name: a.name ?? a.id, emoji: '🤖' }
          const issue = issueByAssignee[a.id] ?? null
          return {
            id: a.id,
            name: display.name ?? a.id,
            emoji: display.emoji ?? '🤖',
            status: a.status,
            ago: a.ago,
            nextRun: a.nextRun ?? null,
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
    } catch {
      // fail silently
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

      {agents.length === 0 ? (
        <div className="text-white/20 text-xs py-2">No active agents right now.</div>
      ) : (
        <div className="space-y-2">
          {agents.map(agent => {
            const dot = statusDot(agent.status, agent.ago)
            const isStale = agent.status === 'idle' && (agent.ago === null || agent.ago > STALE_MINUTES)
            return (
              <div key={agent.id}
                className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 bg-white/[0.03] border border-white/[0.06]">
                {/* Status dot */}
                <div className="flex-shrink-0 mt-0.5">
                  <span
                    className="block w-2 h-2 rounded-full"
                    style={{ background: dot.color, boxShadow: agent.status === 'active' ? `0 0 6px ${dot.color}66` : undefined }}
                  />
                </div>

                {/* Agent info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-white/80">{agent.emoji} {agent.name}</span>
                    {isStale && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-500/80 font-medium">⚠ stale</span>
                    )}
                  </div>

                  {/* Current issue — key · title [status] — status only shown when issue exists (AC 4) */}
                  {agent.issueKey ? (
                    <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                      <span className="text-[10px] font-mono text-white/40">{agent.issueKey}</span>
                      <span className="text-[10px] text-white/30">·</span>
                      <span className="text-[10px] text-white/50 truncate" style={{ maxWidth: '160px', display: 'inline-block', verticalAlign: 'bottom' }}>
                        {agent.issueTitle}
                      </span>
                      {agent.issueStatus && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-white/30 font-mono ml-1 shrink-0">
                          {agent.issueStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  ) : agent.status === 'active' ? (
                    <div className="mt-0.5 text-[10px] text-white/30">Working</div>
                  ) : agent.status === 'scheduled' && agent.nextRun ? (
                    <div className="mt-0.5 text-[10px] text-amber-500/60">Next run {agent.nextRun}</div>
                  ) : null}

                  {/* Last active */}
                  <div className="mt-0.5 text-[9px] text-white/20">{fmtAgo(agent.ago)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
