'use client'
import React, { useState, useEffect } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import { Clock, Activity, CheckCircle2, AlertCircle, Code2, Power, PowerOff } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
interface AgentDetailProps {
  agent: {
    id: string
    name: string
    emoji: string
    role: string
    status: string
    model: string
    modelShort?: string
    workspace?: string
    lastUpdatedAt?: number | null
    currentTask?: string | null
    eligibleStatuses?: string[]
    joinedAt?: string | null
  }
  onToggleActive?: (id: string, active: boolean) => Promise<void>
}

interface Issue {
  id: string
  title: string
  status: string
  priority: string
  task_key?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function relTime(ms: number | undefined | null): string {
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
  if (s === 'closed' || s === 'done' || s === 'released') return 'text-emerald-400'
  return 'text-white/40'
}

function priorityDot(p: string) {
  if (p === 'critical') return 'bg-red-500'
  if (p === 'high') return 'bg-orange-400'
  if (p === 'medium') return 'bg-yellow-400'
  return 'bg-white/20'
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function AgentDetail({ agent, onToggleActive }: AgentDetailProps) {
  const [issues, setIssues] = useState<Issue[]>([])
  // TOD-654: distinguishes "no issues" from "the issue query was refused".
  const [issuesError, setIssuesError] = useState<ApiError | null>(null)
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [toggling, setToggling] = useState(false)

  const isActive = agent.status !== 'paused' && agent.status !== 'inactive'

  useEffect(() => {
    fetchJson<Issue[] | { data?: Issue[] }>(`/api/issues?assignee=${encodeURIComponent(agent.id)}&limit=0`)
      .then(r => {
        if (!r.ok) { setIssuesError(r.error); setIssues([]); setLoadingIssues(false); return }
        setIssuesError(null)
        const data = r.data
        setIssues(Array.isArray(data) ? data : data?.data ?? [])
        setLoadingIssues(false)
      })
  }, [agent.id])

  async function handleToggle() {
    if (!onToggleActive) return
    setToggling(true)
    try {
      await onToggleActive(agent.id, !isActive)
    } finally {
      setToggling(false)
    }
  }

  const activeIssues = issues.filter(i => ['in_progress', 'code_review', 'open'].includes(i.status))
  const recentClosed = issues.filter(i => ['closed', 'done', 'released'].includes(i.status)).slice(0, 3)

  return (
    <div className="space-y-5 text-sm">

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl bg-[#1a1a1a] shrink-0">
          {agent.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white font-semibold truncate">{agent.name}</p>
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-white/20'}`} />
          </div>
          <p className="text-white/50 text-xs truncate">{agent.role}</p>
        </div>
      </div>

      {/* Profile section */}
      <div className="rounded-xl border border-white/10 bg-[#0f0f0f] divide-y divide-white/5">
        <Row label="Role" value={agent.role} />
        <Row label="Workspace" value={agent.workspace ?? 'default'} />
        <Row label="Joined" value={agent.joinedAt ? new Date(agent.joinedAt).toLocaleDateString() : '—'} />
      </div>

      {/* Agent config section */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Agent Configuration</p>
        <div className="rounded-xl border border-white/10 bg-[#0f0f0f] divide-y divide-white/5">
          <Row label="Model" value={agent.model} mono />
          <div className="px-3 py-2.5 flex items-start justify-between gap-3">
            <span className="text-white/40 text-xs shrink-0">Queue filter</span>
            <div className="flex flex-wrap gap-1 justify-end">
              {(agent.eligibleStatuses ?? []).length > 0
                ? (agent.eligibleStatuses ?? []).map(s => (
                    <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50 font-mono">
                      {s}
                    </span>
                  ))
                : <span className="text-white/20 text-xs italic">not configured</span>
              }
            </div>
          </div>
        </div>
      </div>

      {/* Last run + active toggle */}
      <div className="rounded-xl border border-white/10 bg-[#0f0f0f] divide-y divide-white/5">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <Clock size={12} className="text-white/30 shrink-0" />
          <span className="text-white/40 text-xs">Last run</span>
          <span className="text-white/60 text-xs ml-auto">{relTime(agent.lastUpdatedAt)}</span>
        </div>
        {agent.currentTask && (
          <div className="px-3 py-2 flex items-start gap-2">
            <Activity size={12} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-amber-400/80 text-xs truncate">{agent.currentTask}</p>
          </div>
        )}
        {onToggleActive && (
          <div className="px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isActive ? <Power size={12} className="text-emerald-400" /> : <PowerOff size={12} className="text-white/30" />}
              <span className="text-white/40 text-xs">{isActive ? 'Active' : 'Paused'}</span>
            </div>
            <button
              onClick={handleToggle}
              disabled={toggling}
              className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${
                isActive ? 'bg-emerald-500/80' : 'bg-white/10'
              } ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              aria-label={isActive ? 'Pause agent' : 'Activate agent'}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                isActive ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>
        )}
      </div>

      {/* Assigned issues */}
      <div>
        <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Assigned Issues</p>
        {/* TOD-654: a refused issue query is stated, not shown as "no issues". */}
        {issuesError && <ApiErrorBanner error={issuesError} />}
        {loadingIssues && !issuesError && <p className="text-white/20 text-xs">Loading…</p>}
        {!loadingIssues && !issuesError && activeIssues.length === 0 && (
          <p className="text-white/20 text-xs italic">No active issues.</p>
        )}
        <div className="space-y-1.5">
          {activeIssues.slice(0, 8).map(issue => (
            <div key={issue.id} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priorityDot(issue.priority)}`} />
              <div className="flex-1 min-w-0">
                <p className="text-white/70 text-xs truncate">{issue.title}</p>
                {issue.task_key && <p className="text-[9px] text-white/25 font-mono mt-0.5">{issue.task_key}</p>}
              </div>
              <span className={`text-[9px] shrink-0 ${statusColor(issue.status)}`}>{issue.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Activity feed — recent closed */}
      {recentClosed.length > 0 && (
        <div>
          <p className="text-white/30 text-[10px] uppercase tracking-wider mb-2">Recent Activity</p>
          <div className="space-y-1.5">
            {recentClosed.map(issue => (
              <div key={issue.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/5 bg-[#0f0f0f]">
                <CheckCircle2 size={11} className="text-emerald-500/60 shrink-0" />
                <p className="text-white/40 text-xs truncate">{issue.title}</p>
                {issue.task_key && <span className="text-[9px] text-white/20 font-mono ml-auto shrink-0">{issue.task_key}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

// ── Row helper ─────────────────────────────────────────────────────────────────
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-3 py-2.5 flex items-center justify-between gap-3">
      <span className="text-white/40 text-xs shrink-0">{label}</span>
      <span className={`text-white/60 text-xs truncate text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
