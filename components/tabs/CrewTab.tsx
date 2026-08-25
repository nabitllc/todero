'use client'
// TOD-906: Crew tab — workspace members and role management
// Owners can assign/change roles for any human member or agent.
// Members and Viewers see read-only list.

import React, { useEffect, useState, useCallback } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import type { ApiError } from '@/hooks/useApiData'
import { Users, ShieldCheck, Eye, UserCog, Plus, Trash2, RefreshCw, AlertCircle } from 'lucide-react'
import AgentsTab, { type RosterMeta } from '@/components/tabs/AgentsTab'
import MemberDetailView from '@/components/tabs/MemberDetailView'
import type { WorkspaceMember } from '@/lib/rbac-types'

// ── Role badges ───────────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  owner:  { label: 'Owner',  className: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  member: { label: 'Member', className: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  viewer: { label: 'Viewer', className: 'bg-white/10 text-white/50 border border-white/10' },
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner:  'Full access including role management and workspace settings',
  member: 'Full board and issue access; cannot manage roles or workspace settings',
  viewer: 'Read-only access to board and issues; cannot create, edit, or transition',
}

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_BADGE[role] ?? { label: role, className: 'bg-white/10 text-white/50' }
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

// ── AddMemberModal ────────────────────────────────────────────────────────────

function AddMemberModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const [identity, setIdentity] = useState('')
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!identity.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: identity.trim(), role }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to add member')
      onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-white font-semibold text-sm mb-4">Add Workspace Member</h3>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-white/50 text-xs block mb-1">Identity (username, email, or agent ID)</label>
            <input
              autoFocus
              value={identity}
              onChange={e => setIdentity(e.target.value)}
              placeholder="e.g. michael, builder, alice@acme.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-white/50 text-xs block mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as typeof role)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
            >
              <option value="owner">Owner — full access + role management</option>
              <option value="member">Member — full board/issue access</option>
              <option value="viewer">Viewer — read-only</option>
            </select>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <AlertCircle size={12} />
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !identity.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── MemberRow ─────────────────────────────────────────────────────────────────

function MemberRow({
  onSelect,
  member,
  isOwner,
  currentIdentity,
  onRoleChange,
  onRemove,
}: {
  onSelect: (member: WorkspaceMember) => void
  member: WorkspaceMember
  isOwner: boolean
  currentIdentity: string | null
  onRoleChange: (id: string, role: string) => void
  onRemove: (id: string, identity: string) => void
}) {
  const [changing, setChanging] = useState(false)

  async function handleRoleChange(newRole: string) {
    if (newRole === member.role) return
    setChanging(true)
    await onRoleChange(member.id, newRole)
    setChanging(false)
  }

  const isMe = currentIdentity !== null && currentIdentity === member.identity

  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/5 last:border-0">
      <div className={`w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-xs font-medium flex-shrink-0${isMe ? ' ring-2 ring-blue-500/60' : ''}`}>
        {member.identity.charAt(0).toUpperCase()}
      </div>
      <button
        type="button"
        onClick={() => onSelect(member)}
        className="flex-1 min-w-0 text-left rounded-md -mx-1 px-1 py-0.5 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/50 transition-colors"
        aria-label={`Open details for ${member.identity}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-medium truncate">{member.identity}</span>
          {isMe && (
            <span className="bg-blue-500/30 text-blue-300 border border-blue-500/40 px-1.5 py-0.5 rounded text-[9px] font-semibold">You</span>
          )}
        </div>
        {member.assigned_by && (
          <span className="text-white/30 text-[10px]">assigned by {member.assigned_by}</span>
        )}
      </button>
      {isOwner ? (
        <select
          value={member.role}
          onChange={e => handleRoleChange(e.target.value)}
          disabled={changing}
          className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/30 disabled:opacity-50"
        >
          <option value="owner">Owner</option>
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
      ) : (
        <RoleBadge role={member.role} />
      )}
      {isOwner && (
        <button
          onClick={() => onRemove(member.id, member.identity)}
          className="text-white/20 hover:text-red-400 transition-colors p-1"
          title={`Remove ${member.identity}`}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

// ── CrewTab ───────────────────────────────────────────────────────────────────

export default function CrewTab({
  agentsError,
  userRole,
  currentIdentity,
  displayAgents,
  agentLiveStatus,
  agentRunsData,
  liveAgents,
  rosterMeta,
  act,
  agentModal,
  setAgentModal,
  projectFilter,
}: {
  /** Why /api/agents failed, if it did. TOD-654: shown, not swallowed. */
  agentsError?: ApiError | null
  userRole: string | null
  currentIdentity: string | null
  displayAgents: any[]
  agentLiveStatus: (agentId: string) => { dot: 'green' | 'amber' | 'grey'; label: string }
  agentRunsData: Record<string, { taskTitle: string; startedAt: string | null; status: string }>
  liveAgents: any[] | null
  /** Roster provenance from the /api/agents envelope — survives an empty roster. */
  rosterMeta?: RosterMeta | null
  act: (id: string) => string
  agentModal: any
  setAgentModal: (a: any) => void
  projectFilter?: string | null
}) {
  const isOwner = userRole === 'owner' || userRole === 'god' || userRole === 'admin'

  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/roles')
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setMembers(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleRoleChange(id: string, newRole: string) {
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, role: newRole }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Failed to change role')
      }
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRemove(id: string, identity: string) {
    if (!confirm(`Remove ${identity} from workspace?`)) return
    try {
      const res = await fetch(`/api/roles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Failed to remove member')
      }
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="space-y-8">
      {agentsError && <ApiErrorBanner error={agentsError} />}
      {/* ── Role reference ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
          Workspace Roles
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['owner', 'member', 'viewer'] as const).map(r => (
            <div key={r} className="bg-white/3 border border-white/8 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                {r === 'owner'  && <ShieldCheck size={14} className="text-amber-400" />}
                {r === 'member' && <UserCog size={14} className="text-blue-400" />}
                {r === 'viewer' && <Eye size={14} className="text-white/40" />}
                <RoleBadge role={r} />
              </div>
              <p className="text-white/40 text-[11px] leading-relaxed">{ROLE_DESCRIPTIONS[r]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Workspace members ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider">
            Workspace Members
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="text-white/30 hover:text-white/60 transition-colors p-1"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            {isOwner && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/80 text-white text-xs font-medium hover:bg-blue-600 transition-colors"
              >
                <Plus size={12} />
                Add Member
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-xs mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        {!error && members.length === 0 && !loading && (
          <div className="text-white/30 text-sm py-4 text-center">
            No members found. {isOwner ? 'Add the first member above.' : ''}
          </div>
        )}

        {members.length > 0 && (
          <div className="bg-white/3 border border-white/8 rounded-xl px-4">
            {[...members].sort((a, b) => {
              const aIsMe = currentIdentity ? a.identity === currentIdentity : false
              const bIsMe = currentIdentity ? b.identity === currentIdentity : false
              if (aIsMe && !bIsMe) return -1
              if (!aIsMe && bIsMe) return 1
              return 0
            }).map(m => (
              <MemberRow
                key={m.id}
                member={m}
                isOwner={isOwner}
                currentIdentity={currentIdentity}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
                onSelect={setSelectedMember}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Agent roster (existing AgentsTab) ───────────────────────────── */}
      <div>
        <h2 className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
          <span className="flex items-center gap-2"><Users size={12} />Agent Roster</span>
        </h2>
        <AgentsTab
          displayAgents={displayAgents}
          agentLiveStatus={agentLiveStatus}
          agentRunsData={agentRunsData}
          liveAgents={liveAgents}
          rosterMeta={rosterMeta}
          act={act}
          agentModal={agentModal}
          setAgentModal={setAgentModal}
          projectFilter={projectFilter}
        />
      </div>

      {showAdd && (
        <AddMemberModal
          onClose={() => setShowAdd(false)}
          onAdded={load}
        />
      )}

      {selectedMember && (
        <MemberDetailView
          member={{
            id: selectedMember.id,
            name: selectedMember.identity,
            emoji: '👤',
            role: selectedMember.role,
            joinDate: selectedMember.assigned_by ? `assigned by ${selectedMember.assigned_by}` : '',
          }}
          onClose={() => setSelectedMember(null)}
          onNavigateToIssue={issueId => {
            window.location.href = `/?issue=${encodeURIComponent(issueId)}`
          }}
        />
      )}
    </div>
  )
}
