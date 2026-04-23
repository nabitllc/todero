'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { X, Clock } from 'lucide-react'
import { Button } from '@/components/ui'
import AssignedPanel from '@/components/tabs/AssignedPanel'
import ActivityPanel from '@/components/tabs/ActivityPanel'
import { Issue, ActivityItem } from '@/lib/member-utils'

interface HumanMember {
  id: string
  name: string
  emoji: string
  role: string
  joinDate: string
}

interface MemberDetailViewProps {
  member: HumanMember
  onClose: () => void
  onNavigateToIssue?: (issueId: string) => void
}

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
