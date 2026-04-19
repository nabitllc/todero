'use client'
// TOD-1043: Inbox tab — Pending + Historic sub-views with Approve/Deny/Explain actions

import React, { useEffect, useState, useCallback } from 'react'

interface InboxEntry {
  id: string
  agent: string
  type: string
  context: Record<string, unknown> | null
  status: 'pending' | 'approved' | 'denied' | 'timeout' | 'explained'
  created_at: string
  expires_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  response_data: unknown
  issue_id: string | null
}

type ContextFields = Record<string, { label: string; type?: 'text' | 'select'; options?: string[] }>

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', approved: '#10b981', denied: '#ef4444',
  timeout: '#6b7280', explained: '#6366f1',
}

function timeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return '—'
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const m = Math.floor(diff / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function ActionModal({ entry, action, onClose, onSubmit }: {
  entry: InboxEntry
  action: 'approved' | 'denied' | 'explained'
  onClose: () => void
  onSubmit: (responseData: unknown) => void
}) {
  const fields = (entry.context as Record<string, unknown>)?.fields as ContextFields | undefined
  const [reason, setReason] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const label = { approved: 'Approve', denied: 'Deny', explained: 'Explain' }[action]

  const handleSubmit = () => {
    if ((action === 'denied' || action === 'explained') && !reason.trim()) return
    const responseData = action === 'approved' && fields
      ? { ...fieldValues }
      : { reason: reason.trim() || undefined }
    onSubmit(responseData)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f0f] p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <span className="text-white font-semibold">{label} Request</span>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors text-lg leading-none">×</button>
        </div>

        <div className="mb-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-xs text-white/50 mb-1">{entry.agent} · {entry.type}</p>
          <p className="text-xs text-white/70">{JSON.stringify(entry.context, null, 2).slice(0, 300)}</p>
        </div>

        {action === 'approved' && fields && Object.entries(fields).map(([key, field]) => (
          <div key={key} className="mb-3">
            <label className="block text-xs text-white/50 mb-1">{field.label}</label>
            {field.type === 'select' && field.options ? (
              <select
                value={fieldValues[key] ?? ''}
                onChange={e => setFieldValues(p => ({ ...p, [key]: e.target.value }))}
                className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20"
              >
                <option value="">Select…</option>
                {field.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                value={fieldValues[key] ?? ''}
                onChange={e => setFieldValues(p => ({ ...p, [key]: e.target.value }))}
                className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20"
              />
            )}
          </div>
        ))}

        {(action === 'denied' || action === 'explained') && (
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={action === 'denied' ? 'Reason for denial…' : 'Clarification message…'}
            rows={3}
            className="w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-white/20 resize-none mb-3"
          />
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-white/50 hover:text-white transition-colors">Cancel</button>
          <button
            onClick={handleSubmit}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              action === 'denied' ? 'bg-red-600 hover:bg-red-500 text-white'
              : action === 'explained' ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function InboxTab() {
  const [view, setView] = useState<'pending' | 'historic'>('pending')
  const [entries, setEntries] = useState<InboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ entry: InboxEntry; action: 'approved' | 'denied' | 'explained' } | null>(null)

  const fetchEntries = useCallback(async () => {
    const status = view === 'pending' ? '?status=pending' : ''
    const res = await fetch(`/api/inbox${status}`)
    if (res.ok) {
      const data = await res.json()
      setEntries(Array.isArray(data) ? data : [])
    }
    setLoading(false)
  }, [view])

  useEffect(() => {
    setLoading(true)
    fetchEntries()
    if (view !== 'pending') return
    const iv = setInterval(fetchEntries, 10000)
    return () => clearInterval(iv)
  }, [view, fetchEntries])

  const resolve = async (entry: InboxEntry, action: 'approved' | 'denied' | 'explained', responseData?: unknown) => {
    await fetch('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, status: action, resolved_by: 'michael', response_data: responseData }),
    })
    setModal(null)
    fetchEntries()
  }

  const historic = entries.filter(e => e.status !== 'pending')
  const pending = entries.filter(e => e.status === 'pending')
  const displayed = view === 'pending' ? pending : historic

  return (
    <div className="flex flex-col h-full min-h-0">
      {modal && (
        <ActionModal
          entry={modal.entry}
          action={modal.action}
          onClose={() => setModal(null)}
          onSubmit={data => resolve(modal.entry, modal.action, data)}
        />
      )}

      {/* Sub-view toggle */}
      <div className="flex gap-1 px-4 pt-4 pb-2 shrink-0">
        {(['pending', 'historic'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
              view === v ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {v}
            {v === 'pending' && pending.length > 0 && (
              <span className="ml-1.5 bg-amber-500 text-black text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {pending.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading && <p className="text-white/30 text-xs py-8 text-center">Loading…</p>}
        {!loading && displayed.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-white/30 text-sm">{view === 'pending' ? 'No pending requests' : 'No history yet'}</p>
          </div>
        )}
        {displayed.map(entry => (
          <div
            key={entry.id}
            className="rounded-xl border border-white/[0.07] bg-[#0f0f0f] p-4"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-white text-xs font-medium">{entry.agent}</span>
                  <span className="text-white/30 text-[10px]">·</span>
                  <span className="text-white/50 text-[10px]">{entry.type}</span>
                </div>
                <p className="text-white/40 text-[11px] truncate">
                  {typeof entry.context === 'object' && entry.context
                    ? ((entry.context as Record<string, unknown>).summary as string) ??
                      Object.entries(entry.context).filter(([k]) => k !== 'fields').map(([k,v]) => `${k}: ${v}`).join(' · ').slice(0, 120)
                    : String(entry.context ?? '—')}
                </p>
              </div>
              <span
                className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: `${STATUS_COLORS[entry.status]}20`, color: STATUS_COLORS[entry.status] }}
              >
                {entry.status}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-white/25 text-[10px]">
                {view === 'pending'
                  ? `expires ${timeRemaining(entry.expires_at)}`
                  : `resolved ${timeAgo(entry.resolved_at ?? entry.created_at)} by ${entry.resolved_by ?? '—'}`}
              </span>
              {view === 'pending' && (
                <div className="flex gap-1">
                  {(['approved', 'explained', 'denied'] as const).map(action => (
                    <button
                      key={action}
                      onClick={() => setModal({ entry, action })}
                      className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors capitalize ${
                        action === 'approved' ? 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400'
                        : action === 'denied' ? 'bg-red-600/20 hover:bg-red-600/40 text-red-400'
                        : 'bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400'
                      }`}
                    >
                      {action === 'approved' ? 'Approve' : action === 'denied' ? 'Deny' : 'Explain'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
