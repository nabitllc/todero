'use client'
// TOD-1044: Inbox tab — review and resolve agent approval requests

import React, { useEffect, useState, useCallback } from 'react'
import { CheckCircle, XCircle, Clock, Inbox } from 'lucide-react'

interface InboxEntry {
  id: string
  agent: string
  type: string
  context: unknown
  status: 'pending' | 'approved' | 'denied' | 'timeout'
  created_at: string
  expires_at: string | null
  resolved_at: string | null
  resolved_by: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending:  'text-amber-400 bg-amber-400/10',
  approved: 'text-emerald-400 bg-emerald-400/10',
  denied:   'text-red-400 bg-red-400/10',
  timeout:  'text-white/30 bg-white/5',
}

export default function InboxTab() {
  const [entries, setEntries] = useState<InboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [resolving, setResolving] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    const url = filter === 'pending' ? '/api/inbox?status=pending' : '/api/inbox'
    try {
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setEntries(Array.isArray(data) ? data : [])
      }
    } catch {
      // network error — keep existing entries
    }
    setLoading(false)
  }, [filter])

  useEffect(() => {
    setLoading(true)
    fetchEntries()
  }, [fetchEntries])

  const resolve = async (id: string, action: 'approve' | 'deny') => {
    setResolving(id)
    try {
      await fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
    } finally {
      setResolving(null)
      fetchEntries()
    }
  }

  const pendingCount = entries.filter(e => e.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox size={16} className="text-white/40" />
          <h2 className="text-white text-sm font-semibold">Agent Inbox</h2>
          {pendingCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold leading-none">
              {pendingCount}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(['pending', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                'text-[10px] px-2 py-1 rounded font-medium transition-colors ' +
                (filter === f ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60')
              }
            >
              {f === 'pending' ? 'Pending' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-white/30 text-xs">Loading...</p>}

      {!loading && entries.length === 0 && (
        <div className="py-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-white/10" />
          <p className="text-white/25 text-sm">
            No {filter === 'pending' ? 'pending ' : ''}requests
          </p>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(entry => (
          <div
            key={entry.id}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-xs font-medium">{entry.agent}</span>
                  <span className="text-white/30 text-[10px]">→</span>
                  <span className="text-white/60 text-xs">{entry.type}</span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_STYLES[entry.status] ?? ''}`}
                  >
                    {entry.status}
                  </span>
                </div>
                <p className="text-white/25 text-[10px] mt-1">
                  {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
              {entry.status === 'pending' && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => resolve(entry.id, 'approve')}
                    disabled={resolving === entry.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle size={12} /> Approve
                  </button>
                  <button
                    onClick={() => resolve(entry.id, 'deny')}
                    disabled={resolving === entry.id}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    <XCircle size={12} /> Deny
                  </button>
                </div>
              )}
              {entry.status === 'timeout' && (
                <Clock size={14} className="text-white/20 shrink-0 mt-0.5" />
              )}
            </div>
            {Boolean(entry.context) && (
              <pre className="text-[10px] text-white/30 bg-white/[0.03] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify(entry.context, null, 2)}
              </pre>
            )}
            {entry.resolved_by && (
              <p className="text-[9px] text-white/20">Resolved by {entry.resolved_by}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
