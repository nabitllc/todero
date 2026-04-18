'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { X, Clock, CheckCircle2, Activity, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui'

interface HumanMember {
  id: string
  name: string
  emoji: string
  role: string
  joinDate: string
}

interface Issue {
  id: string
  task_key?: string
  title: string
  status: string
  priority?: string
  type?: string
  project?: string
  updated_at?: string
}

interface ActivityItem {
  id: string
  task_key?: string
  title: string
  status: string
  project?: string
  updated_at?: string
}

interface MemberDetailViewProps {
  member: HumanMember
  onClose: () => void
  onNavigateToIssue?: (issueId: string) => void
}

function statusColor(s: string) {
  if (s === 'in_progress') return 'text-amber-400'
  if (s === 'code_review' || s === 'product_review') return 'text-purple-400'
  if (s === 'open') return 'text-blue-400'
  if (['closed', 'completed', 'released', 'done'].includes(s)) return 'text-emerald-400'
  if (s === 'backlog') return 'text-white/30'
  return 'text-white/50'
}

function priorityBadge(p: string | undefined) {
  if (!p) return null
  const cls = p === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : p === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : p === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    : 'bg-white/5 text-white/40 border-white/10'
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase ${cls}`}>
      {p}
    </span>
  )
}

function relTime(iso: string | undefined): string {
  if (!iso) return '—'
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`
  return `${Math.round(diff / 1440)}d ago`
}

function statusVerb(s: string): string {
  const map: Record<string, string> = {
    open: 'opened', in_progress: 'started', code_review: 'sent for review',
    product_review: 'in product review', approved: 'approved',
    completed: 'completed', released: 'released', closed: 'closed',
    backlog: 'in backlog', defined: 'defined', cancelled: 'cancelled',
  }
  return map[s] ?? s.replace('_', ' ')
}

// ── Assigned Issues panel ─────────────────────────────────────────────────────
function AssignedPanel({
  issues,
  loading,
  onNavigate,
}: {
  issues: Issue[]
  loading: boolean
  onNavigate?: (id: string) => void
}) {
  if (loading) return <p className="text-white/20 text-xs">Loading…</p>
  if (issues.length === 0) return <p className="text-white/20 text-xs italic">No active issues assigned.</p>

  return (
    <div className="space-y-2">
      {issues.slice(0, 15).map(issue => (
        <div
          key={issue.id}
          className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f] group"
        >
          <CheckCircle2 size={12} className={statusColor(issue.status)} />
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs truncate">{issue.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {issue.task_key && (
                <span className="text-[9px] text-white/30 font-mono">{issue.task_key}</span>
              )}
              <span className={`text-[9px] ${statusColor(issue.status)}`}>
                {issue.status.replace('_', ' ')}
              </span>
              {issue.project && (
                <span className="text-[9px] text-white/20">{issue.project}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {priorityBadge(issue.priority)}
            {onNavigate && (
              <button
                onClick={() => onNavigate(issue.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title="View on board"
                aria-label={`View issue ${issue.task_key ?? issue.title} on board`}
              >
                <ExternalLink size={11} className="text-white/40 hover:text-white/70" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Activity Feed panel ───────────────────────────────────────────────────────
function ActivityPanel({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  if (loading) return <p className="text-white/20 text-xs">Loading…</p>
  if (items.length === 0) return <p className="text-white/20 text-xs italic">No recent activity.</p>

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
          <Activity size={12} className={`${statusColor(item.status)} mt-0.5 shrink-0`} />
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs truncate">
              {item.task_key && <span className="text-white/30 font-mono mr-1.5">{item.task_key}</span>}
              {item.title} → <span className={statusColor(item.status)}>{statusVerb(item.status)}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {item.project && <span className="text-[9px] text-white/20">{item.project}</span>}
              <span className="text-[9px] text-white/25">{relTime(item.updated_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function MemberDetailView({ member, onClose, onNavigateToIssue }: MemberDetailViewProps) {
  const [activeTab, setActiveTab] = useState<'assigned' | 'activity'>('assigned')
  const [assignedIssues, setAssignedIssues] = useState<Issue[]>([])
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/members/${encodeURIComponent(member.id)}`)
      .then(r => r.json())
      .then(data => {
        setAssignedIssues(Array.isArray(data.assignedIssues) ? data.assignedIssues : [])
        setActivityFeed(Array.isArray(data.activityFeed) ? data.activityFeed : [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [member.id])

  useEffect(() => { load() }, [load])

  const joinDateFormatted = member.joinDate
    ? new Date(member.joinDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl md:rounded-2xl rounded-t-2xl border border-white/10 bg-[#080808] flex flex-col max-h-[92vh] md:max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 pt-5 pb-4 border-b border-white/10 shrink-0">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 bg-white/5 border border-white/10">
            {member.emoji}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-base">{member.name}</p>
            <p className="text-white/50 text-xs">{member.role}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Clock size={10} className="text-white/30" />
              <span className="text-white/30 text-[10px]">Joined {joinDateFormatted}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            <Button variant="icon" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 px-5 pt-4 pb-2 shrink-0">
          <div className="bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3">
            <p className="text-white/30 text-[10px] mb-0.5">Assigned</p>
            <p className="text-white/70 text-lg font-bold">{loading ? '—' : assignedIssues.length}</p>
          </div>
          <div className="bg-[#0f0f0f] border border-white/10 rounded-xl px-4 py-3">
            <p className="text-white/30 text-[10px] mb-0.5">Recent Activity</p>
            <p className="text-white/70 text-lg font-bold">{loading ? '—' : activityFeed.length}</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-5 pb-2 shrink-0">
          {(['assigned', 'activity'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 ${
                activeTab === t
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5'
              }`}
            >
              {t === 'assigned' ? 'Assigned Issues' : 'Activity Feed'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {activeTab === 'assigned' && (
            <AssignedPanel issues={assignedIssues} loading={loading} onNavigate={onNavigateToIssue} />
          )}
          {activeTab === 'activity' && (
            <ActivityPanel items={activityFeed} loading={loading} />
          )}
        </div>
      </div>
    </div>
  )
}
