'use client'
// ─── components/tabs/CrewTab.tsx — Fleet ▸ Team ─────────────────────────────
//
// fleet-cards piece. This surface used to be three stacked <h2> sections with
// no card contract at all: a static role legend, a member list, and the legacy
// AgentsTab grid. design/Fleet.dc.html asks for a Roster that answers one
// question with one number and says where every row came from, and the piece
// brief's complaint is precise — the roster showed sixteen rows all reading
// `never`, and nothing said whether that meant "no agent has ever checked in"
// or "we did not look".
//
// What changed, and why each thing is the way it is:
//
// 1. Everything renders inside components/nav/Card.tsx — the same shell Work
//    and Settings use. One question per title, one number from a real query,
//    the query printed underneath, a collapse that persists, an empty state
//    that names the fleet, and an error that REPLACES the body.
//
// 2. Liveness is classified by lib/fleet-liveness.ts, against the window
//    design/Fleet.dc.html states in words ("Offline after 10m of silence"),
//    and it has the state the old vocabulary lacked: `unknown`, for a
//    heartbeat store that could not be read. `never` is now a claim the
//    server earned by reading the store and finding nothing.
//
// 3. The legacy AgentsTab grid is no longer rendered HERE. It renders its own
//    liveness words from GET /api/agents' 60-second `live | stale | idle`
//    vocabulary (lib/agent-liveness.ts), and two roster renderings on one
//    screen wording the same timestamp differently is exactly the confusion
//    this piece is meant to remove. AgentsTab itself is untouched and other
//    surfaces still use it; its agent detail modal (AgentDetailView, which
//    carries the pause/remove/heartbeat controls) is mounted directly from
//    here so nothing was lost with it.
//
// 4. The Run control is DISABLED with the dispatch reason, never armed and
//    then refused. lib/dispatch-guard.ts is untouched: this asks the server
//    `POST /api/run-agent?dryRun=1` whether a dispatch would be allowed, and
//    when the answer is no it renders a control that sends nothing.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import { Lock, Trash2 } from 'lucide-react'
import Card from '@/components/nav/Card'
import AgentDetailView from '@/components/tabs/AgentDetailView'
import AgentLaunchControl from '@/components/tabs/AgentLaunchControl'
import FleetRegisterCard from '@/components/tabs/FleetRegisterCard'
import MemberDetailView from '@/components/tabs/MemberDetailView'
import type { RosterMeta } from '@/components/tabs/AgentsTab'
import type { WorkspaceMember } from '@/lib/rbac-types'
import type { VaultBadgeInfo } from '@/lib/vault-badge'
import type { AgentRunStatus } from '@/hooks/useAgentStatus'
import {
  describeLiveness,
  fleetHeadline,
  fleetProvenanceLine,
  summarizeFleet,
  type FleetLiveness,
} from '@/lib/fleet-liveness'

// ── Types over the two endpoints this file reads ─────────────────────────────

/** The fields of GET /api/agents' AgentDto this surface renders. */
interface RosterRowData {
  id: string
  name: string
  emoji?: string
  role?: string
  model?: string
  lastSeenAt: number | null
  livenessSource?: 'heartbeat' | 'none'
  rosterSource?: string
  rosterPath?: string | null
  /** Brain2 manifest fields, or null when the vault does not name this id. */
  vault?: VaultBadgeInfo | null
}

interface AgentsEnvelope {
  agents: RosterRowData[]
  rosterPath: string | null
  vaultPath: string | null
  livenessSource: 'heartbeat' | 'none'
  heartbeatStore: string | null
  heartbeatWarning: string | null
}

const ROSTER_QUERY = '/api/agents'
const DISPATCH_PROBE = '/api/run-agent?dryRun=1'

const LIVENESS_TONE: Record<FleetLiveness, string> = {
  live: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  offline: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  never: 'text-white/45 border-white/15 bg-white/5',
  unknown: 'text-purple-300 border-purple-500/40 bg-purple-500/10',
}

/**
 * Where this row came from, in words. A row with no Brain2 manifest SAYS it
 * has none rather than borrowing a tier or a model from somewhere plausible —
 * "if a roster row has no manifest, say so instead of implying one".
 */
function rowProvenance(row: RosterRowData, env: AgentsEnvelope | null): string {
  const manifest = row.vault
    ? `Brain2 manifest ${env?.vaultPath ? `${env.vaultPath}\\${row.id}\\manifest.json` : `for "${row.id}"`}`
    : 'no Brain2 manifest for this id'
  switch (row.rosterSource) {
    case 'registered':
      return `self-registered through POST /api/connect · ${manifest}`
    case 'vault':
      return manifest
    case 'agents-md':
      return `${row.rosterPath ?? env?.rosterPath ?? 'AGENTS.md'} · ${manifest}`
    default:
      return `${row.rosterSource ?? 'source not reported by /api/agents'} · ${manifest}`
  }
}

// ── The Run control ──────────────────────────────────────────────────────────

/**
 * design/Fleet.dc.html: "the control never appears live and then refuses."
 *
 * `dispatchEnabled` is a fact about the instance, not about one agent, and it
 * is read from the server's own dry run rather than guessed from anything in
 * the browser. While that answer is still in flight nothing clickable is
 * rendered at all. When dispatch IS armed the per-agent control takes over —
 * it runs its own per-agent dry run, because a runtime that is missing for
 * one agent is not a fact this shared probe can know.
 */
function RunControl({
  dispatchEnabled,
  reason,
  row,
}: {
  dispatchEnabled: boolean | null
  reason: string | null
  row: RosterRowData
}) {
  if (dispatchEnabled === null) {
    return <span className="text-white/25 text-[10px] font-mono shrink-0">checking dispatch…</span>
  }
  if (dispatchEnabled) {
    return <AgentLaunchControl agentId={row.id} vault={row.vault ?? null} />
  }
  return (
    <button
      type="button"
      disabled
      title={reason ?? undefined}
      className="flex items-center gap-1.5 text-[11px] font-medium text-white/30 border border-white/12 rounded-md px-2.5 py-1 cursor-not-allowed shrink-0"
    >
      <Lock size={10} />
      Run — disabled
    </button>
  )
}

// ── Roster card ──────────────────────────────────────────────────────────────

function RosterCard({
  onOpen,
}: {
  onOpen: (row: RosterRowData) => void
}) {
  const [env, setEnv] = useState<AgentsEnvelope | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [dispatch, setDispatch] = useState<{ enabled: boolean; reason: string | null } | null>(null)
  // Re-render on a timer so the ages below stay true without a reload; the
  // fetch itself is what refreshes the timestamps.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const r = await fetchJson<AgentsEnvelope>(ROSTER_QUERY)
    if (r.ok && Array.isArray(r.data?.agents)) {
      setEnv(r.data)
      setError(null)
    } else {
      setEnv(null)
      setError(r.ok ? { status: r.status, endpoint: ROSTER_QUERY, message: 'response carried no agents array' } : r.error)
    }
    setNow(Date.now())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
    const iv = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(iv)
  }, [load])

  // One probe for the whole roster. `dispatchEnabled` comes from
  // lib/dispatch-guard.ts server-side; this only reads it.
  useEffect(() => {
    let cancelled = false
    void fetchJson<{ dispatchEnabled?: boolean; unavailableReason?: string | null; error?: string }>(
      DISPATCH_PROBE,
      { method: 'POST' },
    ).then(r => {
      if (cancelled) return
      if (!r.ok) {
        setDispatch({ enabled: false, reason: `could not ask the server whether dispatch is armed: ${r.error.message}` })
        return
      }
      setDispatch({
        enabled: r.data?.dispatchEnabled === true,
        reason:
          r.data?.dispatchEnabled === true
            ? null
            : 'Dispatch is disabled on this instance. Set TODERO_DISPATCH_ENABLED=1 to arm it (lib/dispatch-guard.ts).',
      })
    })
    return () => { cancelled = true }
  }, [])

  const rows = env?.agents ?? []
  const observed = env?.livenessSource === 'heartbeat'
  const inputs = rows.map(r => ({
    lastSeenAt: r.lastSeenAt ?? null,
    observed: (r.livenessSource ?? env?.livenessSource) === 'heartbeat',
  }))
  const summary = summarizeFleet(inputs, now)

  // GET /api/agents takes no limit or offset — it returns the union of every
  // source in full — so this length is an exact count, not the size of a page.
  const source = (
    <>
      GET {ROSTER_QUERY} — full roster envelope, no limit/offset, so the count is exact
      <br />
      {fleetProvenanceLine(inputs, now)}
      <br />
      liveness: lib/fleet-liveness.ts, offline after 10m of silence (design/Fleet.dc.html). The agent detail
      view applies the server&apos;s narrower 60s window (lib/agent-liveness.ts) to this same timestamp.
      {env?.heartbeatStore && <> · heartbeats read from {env.heartbeatStore}</>}
    </>
  )

  if (error) {
    return (
      <Card id="fleet-roster" title="Which agents exist, and which are alive?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <Card
      id="fleet-roster"
      title="Which agents exist, and which are alive?"
      source={source}
      // Card's one number is the registered count; the per-state breakdown is
      // the first line of the body rather than the header, because the header
      // truncates and a truncated "…· 1 live" is worse than no breakdown.
      metric={loaded ? { value: summary.registered, label: 'registered' } : undefined}
      empty={
        loaded && rows.length === 0
          ? {
              active: true,
              message: `No agent is declared in ${env?.rosterPath ?? 'this host’s AGENTS.md'}, no Brain2 manifest was found in ${env?.vaultPath ?? 'the vault registry'}, and no agent has self-registered — so this fleet has no roster.`,
            }
          : undefined
      }
    >
      <p className="font-mono text-[11px] text-white/60 mb-2">{fleetHeadline(summary)}</p>
      {env?.heartbeatWarning && (
        <p className="text-amber-300/80 text-[11px] leading-relaxed mb-2 break-words">{env.heartbeatWarning}</p>
      )}
      {!observed && rows.length > 0 && (
        <p className="text-purple-300/85 text-[11px] leading-relaxed mb-2">
          The heartbeat store could not be read on this host, so every row below reads <em>not measured</em>. That is
          not the same as &ldquo;no agent has ever checked in&rdquo; — nothing was looked at.
        </p>
      )}
      <ul className="divide-y divide-white/5">
        {rows.map(row => {
          const desc = describeLiveness(
            { lastSeenAt: row.lastSeenAt ?? null, observed: (row.livenessSource ?? env?.livenessSource) === 'heartbeat' },
            now,
          )
          return (
            <li key={row.id} className="py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="flex items-center gap-2 min-w-0 text-left rounded hover:bg-white/5 -mx-1 px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-white/40"
                  aria-label={`Open details for ${row.name}`}
                >
                  <span className="text-sm shrink-0" aria-hidden="true">{row.emoji ?? '•'}</span>
                  <span className="text-white text-[13px] font-semibold truncate">{row.name}</span>
                </button>
                <span className={`font-mono text-[10px] rounded px-1.5 py-0.5 border shrink-0 ${LIVENESS_TONE[desc.state]}`}>
                  {desc.badge}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-white/50 bg-white/5 rounded px-1.5 py-0.5 shrink-0">
                  {row.vault ? `tier ${row.vault.tier}` : 'no tier declared'}
                </span>
              </div>
              <p className="font-mono text-[10.5px] text-white/55 break-all">{row.model ?? 'no model reported by /api/agents'}</p>
              <p className="font-mono text-[10px] text-white/42 leading-snug">{desc.label}</p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-[10px] text-white/30 leading-snug break-all min-w-0">{rowProvenance(row, env)}</p>
                <span className="flex-1" />
                <RunControl dispatchEnabled={dispatch === null ? null : dispatch.enabled} reason={dispatch?.reason ?? null} row={row} />
              </div>
            </li>
          )
        })}
      </ul>
      {dispatch && !dispatch.enabled && (
        <p className="flex items-start gap-2 text-white/40 text-[11px] leading-relaxed mt-2 pt-2 border-t border-white/5">
          <Lock size={12} className="shrink-0 mt-0.5" />
          <span>
            Run is disabled because dispatch is off. Set{' '}
            <span className="font-mono text-white/65">TODERO_DISPATCH_ENABLED=1</span> to arm it — the control never
            appears live and then refuses. Asked of the server at{' '}
            <span className="font-mono text-white/55">POST {DISPATCH_PROBE}</span>; the real{' '}
            <span className="font-mono text-white/55">POST /api/run-agent</span> answers 503 DISPATCH_DISABLED while
            it is off.
          </span>
        </p>
      )}
    </Card>
  )
}

// ── Workspace members ────────────────────────────────────────────────────────

const ROLE_LINE: Record<string, string> = {
  owner: 'full access, including role management and workspace settings',
  member: 'full board and issue access; cannot manage roles or workspace settings',
  viewer: 'read-only; cannot create, edit, or transition',
}

function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [identity, setIdentity] = useState('')
  const [role, setRole] = useState<'owner' | 'member' | 'viewer'>('member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!identity.trim()) return
    setSaving(true)
    setError(null)
    const r = await fetchJson<{ error?: string }>('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: identity.trim(), role }),
    })
    setSaving(false)
    if (!r.ok) { setError(r.error.message); return }
    onAdded()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 w-full max-w-sm shadow-xl">
        <h3 className="text-white font-semibold text-sm mb-4">Add workspace member</h3>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-white/50 text-xs block mb-1">Identity (username, email, or agent id)</span>
            <input
              autoFocus
              value={identity}
              onChange={e => setIdentity(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/20 focus:outline-none focus:border-white/30"
            />
          </label>
          <label className="block">
            <span className="text-white/50 text-xs block mb-1">Role</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value as typeof role)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
            >
              {(['owner', 'member', 'viewer'] as const).map(r => (
                <option key={r} value={r}>{r} — {ROLE_LINE[r]}</option>
              ))}
            </select>
          </label>
          {error && <p className="text-red-400 text-xs break-words">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !identity.trim()} className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {saving ? 'Adding…' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CrewCard({
  isOwner,
  currentIdentity,
  onSelect,
}: {
  isOwner: boolean
  currentIdentity: string | null
  onSelect: (m: WorkspaceMember) => void
}) {
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    const r = await fetchJson<WorkspaceMember[]>('/api/roles')
    if (r.ok && Array.isArray(r.data)) { setMembers(r.data); setError(null) }
    else { setMembers([]); setError(r.ok ? { status: r.status, endpoint: '/api/roles', message: 'response was not a list of members' } : r.error) }
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])

  const source = 'GET /api/roles — every workspace role row, no limit/offset, so the count is exact'

  if (error) {
    return (
      <Card id="fleet-crew" title="Who can change what in this workspace?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <>
      <Card
        id="fleet-crew"
        title="Who can change what in this workspace?"
        source={source}
        metric={loaded ? { value: members.length, label: 'members' } : undefined}
        action={isOwner ? { label: 'Add member', onClick: () => setShowAdd(true) } : undefined}
        empty={loaded && members.length === 0 ? { active: true, message: 'No human or agent identity holds a role in this workspace yet, so nobody but the owner cookie can act on this fleet.' } : undefined}
      >
        <ul className="divide-y divide-white/5">
          {members.map(m => {
            const isMe = currentIdentity !== null && currentIdentity === m.identity
            return (
              <li key={m.id} className="flex items-center gap-2.5 py-2">
                <span className={`w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-[11px] font-medium shrink-0${isMe ? ' ring-2 ring-blue-500/60' : ''}`}>
                  {m.identity.charAt(0).toUpperCase()}
                </span>
                <button type="button" onClick={() => onSelect(m)} className="flex-1 min-w-0 text-left rounded hover:bg-white/5 px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-white/40">
                  <span className="text-white text-[13px] font-medium truncate block">{m.identity}{isMe && <span className="text-blue-300 text-[10px] ml-1.5">you</span>}</span>
                  <span className="text-white/30 text-[10px]">{m.assigned_by ? `assigned by ${m.assigned_by}` : 'no assigning identity recorded'}</span>
                </button>
                {isOwner ? (
                  <select
                    value={m.role}
                    onChange={async e => {
                      const r = await fetchJson('/api/roles', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: m.id, role: e.target.value }),
                      })
                      if (!r.ok) setError(r.error)
                      await load()
                    }}
                    className="bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-white/30"
                  >
                    {(['owner', 'member', 'viewer'] as const).map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <span className="text-white/50 text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10">{m.role}</span>
                )}
                {isOwner && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Remove ${m.identity} from workspace?`)) return
                      const r = await fetchJson(`/api/roles?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
                      if (!r.ok) setError(r.error)
                      await load()
                    }}
                    className="text-white/20 hover:text-red-400 transition-colors p-1 shrink-0"
                    title={`Remove ${m.identity}`}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="text-white/30 text-[10px] leading-relaxed mt-2 pt-2 border-t border-white/5">
          {(['owner', 'member', 'viewer'] as const).map(r => `${r}: ${ROLE_LINE[r]}`).join(' · ')}
        </p>
      </Card>
      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </>
  )
}

// ── CrewTab ──────────────────────────────────────────────────────────────────

export default function CrewTab({
  agentsError,
  userRole,
  currentIdentity,
  agentModal,
  setAgentModal,
  onAgentRemoved,
}: {
  /** Why app/page.tsx's own /api/agents load failed, if it did. The roster
   *  card below re-fetches on its own 30s timer and renders its own error, so
   *  this is only a banner for the surrounding page's copy of that state. */
  agentsError?: ApiError | null
  userRole: string | null
  currentIdentity: string | null
  // Props app/page.tsx passes that this surface no longer reads. The roster
  // card asks /api/agents itself so its numbers and its ages refresh on the
  // Team view, which the page-level loader only polls on the Office view.
  displayAgents?: unknown[]
  agentLiveStatus?: (agentId: string) => { dot: 'green' | 'amber' | 'grey'; label: string }
  agentRunsData?: Record<string, { taskTitle: string; startedAt: string | null; status: AgentRunStatus }>
  liveAgents?: unknown[] | null
  rosterMeta?: RosterMeta | null
  projectFilter?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentDetailView's own prop type
  agentModal: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AgentDetailView's own prop type
  setAgentModal: (a: any) => void
  onAgentRemoved?: (agentId: string) => void
}) {
  const isOwner = userRole === 'owner' || userRole === 'god' || userRole === 'admin'
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null)

  return (
    <div className="space-y-4">
      {agentsError && <ApiErrorBanner error={agentsError} />}

      <RosterCard onOpen={setAgentModal} />
      <FleetRegisterCard />
      <CrewCard isOwner={isOwner} currentIdentity={currentIdentity} onSelect={setSelectedMember} />

      {agentModal && (
        <AgentDetailView agent={agentModal} onClose={() => setAgentModal(null)} onRemoved={onAgentRemoved} />
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
          onNavigateToIssue={issueId => { window.location.href = `/?issue=${encodeURIComponent(issueId)}` }}
        />
      )}
    </div>
  )
}
