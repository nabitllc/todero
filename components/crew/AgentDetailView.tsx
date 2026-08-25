'use client'
// TOD-1598: Agent detail view for /crew/[id] — page-based (not modal)
// Shows model, queue filters, active/paused toggle, last-run, assigned issues, activity feed.

import React, { useState, useEffect } from 'react'
import { AGENT_QUEUE_CONFIGS } from '@/lib/agent-queue'
import { AGENT_REGISTRY } from '@/lib/agent-capabilities'

interface Issue {
  id: string
  task_key?: string
  title: string
  status: string
  priority?: string
  updated_at?: string
}

function relTime(ms: number | null | undefined): string {
  if (!ms) return 'Never'
  const diff = Math.round((Date.now() - ms) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`
  return `${Math.round(diff / 1440)}d ago`
}

function statusColor(s: string) {
  if (s === 'in_progress') return 'text-amber-400'
  if (s === 'code_review') return 'text-purple-400'
  if (s === 'open') return 'text-blue-400'
  if (s === 'closed' || s === 'released') return 'text-emerald-400'
  return 'text-white/40'
}

export default function AgentDetailView({ agentId }: { agentId: string }) {
  const agent = AGENT_REGISTRY[agentId as keyof typeof AGENT_REGISTRY]
  const queueConfig = AGENT_QUEUE_CONFIGS[agentId]
  const [issues, setIssues] = useState<Issue[]>([])
  const [paused, setPaused] = useState(false)
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    fetch(`/api/issues?assignee=${encodeURIComponent(agentId)}`)
      .then(r => r.json())
      .then(d => setIssues(Array.isArray(d?.data ?? d) ? (d?.data ?? d) : []))
      .catch(() => {})

    fetch(`/api/agent-pause?agent=${encodeURIComponent(agentId)}`)
      .then(r => r.json())
      .then(d => setPaused(d.is_paused === true))
      .catch(() => {})

    // Envelope-or-array: /api/agents returns { agents, configured, error }.
    fetch('/api/agents')
      .then(r => r.json())
      .then((body: any) => {
        const agents: any[] = Array.isArray(body) ? body : Array.isArray(body?.agents) ? body.agents : []
        const found = agents.find(a => a.id === agentId)
        if (found?.lastUpdatedAt) setLastRun(found.lastUpdatedAt)
      })
      .catch(() => {})
  }, [agentId])

  async function togglePause() {
    setToggling(true)
    try {
      const res = await fetch('/api/agent-pause', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: agentId, paused: !paused }),
      })
      if (res.ok) setPaused(p => !p)
    } finally {
      setToggling(false)
    }
  }

  if (!agent) {
    return <p className="text-white/40 text-sm p-8">Agent &quot;{agentId}&quot; not found.</p>
  }

  const activeIssues = issues.filter(i => ['open', 'in_progress', 'code_review'].includes(i.status))
  const eligibleStatuses = queueConfig ? [queueConfig.pickupStatus] : []
  const extraFilters = queueConfig?.extraFilters ?? ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 p-5 rounded-2xl border border-white/10 bg-[#0f0f0f]">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
          style={{ background: agent.color + '18', border: '1px solid ' + agent.color + '30' }}
        >
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-white font-bold text-lg">{agent.name}</h1>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">
              {agent.modelShort ?? queueConfig?.model ?? '—'}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${
              paused
                ? 'bg-red-500/20 text-red-400 border-red-500/30'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            }`}>{paused ? 'Paused' : 'Active'}</span>
          </div>
          <p className="text-white/50 text-sm mt-0.5">{agent.role}</p>
          <p className="text-white/30 text-xs mt-1">{agent.description}</p>
        </div>
        <button
          onClick={togglePause}
          disabled={toggling}
          aria-label={paused ? `Unpause ${agent.name}` : `Pause ${agent.name}`}
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-50 ${
            paused
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              : 'border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20'
          }`}
        >
          {toggling ? '…' : paused ? 'Unpause' : 'Pause'}
        </button>
      </div>

      {/* Agent-specific metadata */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Model</p>
          <p className="text-white/70 text-xs font-mono break-all">{agent.modelShort ?? queueConfig?.model ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Queue Filters</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {eligibleStatuses.map(s => (
              <span key={s} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono">{s}</span>
            ))}
          </div>
          {extraFilters && (
            <p className="text-white/20 text-[9px] font-mono mt-1 break-all">{extraFilters}</p>
          )}
        </div>
        <div className="rounded-xl border border-white/10 p-4 bg-[#0f0f0f]">
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">Last Run</p>
          <p className="text-white/70 text-xs">{relTime(lastRun)}</p>
        </div>
      </div>

      {/* Assigned issues */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">
          Assigned Issues ({activeIssues.length} active)
        </p>
        {activeIssues.length === 0 ? (
          <p className="text-white/20 text-xs italic px-1">No active issues assigned.</p>
        ) : (
          <div className="space-y-2">
            {activeIssues.slice(0, 10).map(issue => (
              <div key={issue.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-white/10 bg-[#0f0f0f]">
                {issue.task_key && (
                  <span className="text-[10px] font-mono text-white/30 shrink-0">{issue.task_key}</span>
                )}
                <p className="flex-1 text-white/70 text-xs truncate">{issue.title}</p>
                <span className={`text-[9px] shrink-0 ${statusColor(issue.status)}`}>
                  {issue.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity feed — most recently updated issues */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Recent Activity</p>
        {issues.length === 0 ? (
          <p className="text-white/20 text-xs italic px-1">No recent activity.</p>
        ) : (
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 overflow-hidden">
            {issues.slice(0, 8).map(issue => (
              <div key={issue.id + '-act'} className="flex items-center gap-3 px-3 py-2.5 bg-[#0f0f0f] text-xs">
                <span className="text-white/20 text-[9px] shrink-0">
                  {issue.updated_at ? new Date(issue.updated_at).toLocaleDateString() : '—'}
                </span>
                <span className="flex-1 text-white/50 truncate">{issue.title}</span>
                <span className={`text-[9px] shrink-0 ${statusColor(issue.status)}`}>
                  {issue.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
