'use client'
// TOD-1043: Inbox tab — Pending + Historic sub-views with Approve/Deny/Explain actions

import React, { useState } from 'react'
import { useApiList, fetchJson, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'

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

/** The fallback shape PATCH /api/inbox writes to `context.resolution` when
 * the `response_data` column doesn't exist — see app/api/inbox/route.ts. */
interface ContextResolution {
  by?: string
  at?: string
  status?: string
  /** Round-3 shape: `{effect, ok, detail}` — what the decision actually did. */
  effect?: unknown
  /** Pre-round-3 shape, kept for entries resolved before this fix. */
  data?: unknown
}

/** Round-3: response_data is now the real consequence of a decision, not the
 * reason a human typed — see app/api/inbox/route.ts's INBOX_EFFECTS map. */
interface EffectOutcome {
  effect?: unknown
  ok?: unknown
  detail?: unknown
}

function isEffectOutcome(payload: unknown): payload is EffectOutcome {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) && 'effect' in payload && 'detail' in payload
}

function formatResolutionPayload(data: unknown): string | null {
  if (data === null || data === undefined) return null
  // The real shape since round 3: what the decision actually did, not what
  // the human typed. Render that outcome, flagging a failed effect plainly
  // rather than letting it read like a clean success.
  if (isEffectOutcome(data)) {
    const detail = typeof data.detail === 'string' && data.detail.trim() ? data.detail.trim() : String(data.effect ?? '')
    if (!detail) return null
    return data.ok === false ? `${detail} (FAILED)` : detail
  }
  // Pre-round-3 entries: response_data was whatever the human typed in the
  // modal (a deny reason, or field values). Kept so old history still renders.
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (typeof obj.reason === 'string' && obj.reason.trim()) return obj.reason.trim()
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')
    if (entries.length === 0) return null
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ')
  }
  const str = String(data).trim()
  return str || null
}

/** What actually happened as a result of a decision, for the historic view.
 * Reads the real `response_data` column when it's present, and falls back to
 * `context.resolution` (the read-modify-write the API does when that column
 * is missing) so the payload is visible either way instead of vanishing. */
function resolutionLine(entry: InboxEntry): string | null {
  const contextResolution = (entry.context && typeof entry.context === 'object' && !Array.isArray(entry.context))
    ? (entry.context as Record<string, unknown>).resolution as ContextResolution | undefined
    : undefined

  const payload = entry.response_data ?? contextResolution?.effect ?? contextResolution?.data
  const detail = formatResolutionPayload(payload)
  if (!detail) return null

  const by = entry.resolved_by ?? contextResolution?.by ?? '—'
  return `${entry.status} by ${by} — ${detail}`
}

/** Request types with a registered automated consequence — mirrors
 * INBOX_EFFECTS in app/api/inbox/route.ts. A type NOT in this set has no
 * effect the server can dispatch, so it must not show Approve/Deny (buttons
 * that imply a consequence they don't have) — it gets a single Acknowledge
 * action instead. */
const TYPES_WITH_EFFECT = new Set(['loop_breaker_pause', 'ceiling_stop'])

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
  const [modal, setModal] = useState<{ entry: InboxEntry; action: 'approved' | 'denied' | 'explained' } | null>(null)
  const [actionError, setActionError] = useState<ApiError | null>(null)

  // `items` stays null on a failed fetch — never coerced to [] — so a 403/500
  // renders the error banner instead of a lying "No pending requests".
  const { items, error, loading, refetch } = useApiList<InboxEntry>(
    view === 'pending' ? '/api/inbox?status=pending' : '/api/inbox',
  )

  // Poll the pending view every 10s. Skipped entirely while a fetch is
  // erroring so we don't hammer a broken endpoint.
  React.useEffect(() => {
    if (view !== 'pending') return
    const iv = setInterval(refetch, 10000)
    return () => clearInterval(iv)
  }, [view, refetch])

  const resolve = async (entry: InboxEntry, action: 'approved' | 'denied' | 'explained', responseData?: unknown) => {
    const r = await fetchJson<InboxEntry & { _warning?: string }>('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, status: action, resolved_by: 'michael', response_data: responseData }),
    })
    setModal(null)
    if (!r.ok) { setActionError(r.error); return }
    // A 2xx can still carry a `_warning` (e.g. response_data fell back to
    // context.resolution because the dedicated column is missing) — show it
    // instead of letting a partial write look like a clean success.
    setActionError(
      r.data._warning
        ? { status: r.status, endpoint: '/api/inbox', message: r.data._warning }
        : null,
    )
    refetch()
  }

  const entries = items ?? []
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
        {actionError && (
          <ApiErrorBanner error={actionError} onRetry={() => setActionError(null)} />
        )}
        {error && <ApiErrorBanner error={error} onRetry={refetch} />}
        {!error && loading && <p className="text-white/30 text-xs py-8 text-center">Loading…</p>}
        {!error && !loading && displayed.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-white/30 text-sm">{view === 'pending' ? 'No pending requests' : 'No history yet'}</p>
          </div>
        )}
        {!error && displayed.map(entry => (
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

            {view === 'historic' && resolutionLine(entry) && (
              <p className="text-white/40 text-[11px] mb-2">{resolutionLine(entry)}</p>
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-white/25 text-[10px]">
                {view === 'pending'
                  ? `expires ${timeRemaining(entry.expires_at)}`
                  : `resolved ${timeAgo(entry.resolved_at ?? entry.created_at)} by ${entry.resolved_by ?? '—'}`}
              </span>
              {view === 'pending' && (
                <div className="flex gap-1">
                  {TYPES_WITH_EFFECT.has(entry.type) ? (
                    (['approved', 'explained', 'denied'] as const).map(action => (
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
                    ))
                  ) : (
                    // No registered effect for this type (see TYPES_WITH_EFFECT above) —
                    // Approve/Deny would imply a consequence the server can't dispatch.
                    <button
                      onClick={() => resolve(entry, 'explained', { reason: 'Acknowledged — no automated effect for this request type.' })}
                      className="px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors bg-white/10 hover:bg-white/20 text-white/70"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
