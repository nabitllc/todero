'use client'
// components/IssueDetailOverlay.tsx — issue-permalink piece.
//
// The surface a `/i/<task-key>` permalink (see lib/issue-permalink.ts) and a
// palette Enter (see SearchOverlay.tsx) both land on: one issue, fetched by
// its own key, rendered over whatever destination is behind it — the same
// "overlay, not a route" shape components/nav/ChatOverlay.tsx already
// established for Chat, reused here rather than invented a second way.
//
// SCOPE: this component adds no endpoint and no scope logic of its own.
// `GET /api/issues?task_key=` is already scoped server-side by the request's
// OWN path when that path is `/p/<slug>/i/<key>` (middleware.ts's
// `projectFromPathname` treats `i` exactly like any other non-exempt
// destination segment — measured 2026-08-26, see the piece doc) — the same
// enforcement every other view already depends on, not something added here.
// The client-side project comparison below is belt-and-suspenders, matching
// the same check components/SearchOverlay.tsx already made for the identical
// reason: defense in depth, never the boundary itself.

import React, { useCallback, useEffect, useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { projectFromPath } from '@/lib/search-commands'
import { issuePermalinkPath } from '@/lib/issue-permalink'
import { readyIssueVerbs, runIssueVerb, withheldIssueVerbs, type IssueVerb } from '@/lib/issue-verbs'
import type { MoveIssue } from '@/lib/issue-moves'

interface IssueRow extends MoveIssue {
  task_key?: string
  title?: string
  status?: string
  type?: string
  priority?: string
  severity?: string | null
  assignee?: string
  owner?: string
  sprint?: string | null
  project?: string
  due_date?: string | null
  description?: string | null
  acceptance_criteria?: string | null
  implementation_notes?: string | null
  created_at?: string
  updated_at?: string
}

interface Props {
  /** Normalised (`TOD-9`), or null — null renders nothing, matching
   *  ChatOverlay's `open` boolean convention with one fewer prop. */
  taskKey: string | null
  onClose: () => void
}

type Leg = { state: 'loading' | 'ok' | 'missing' | 'error'; data: IssueRow | null; error: ApiError | null }

export default function IssueDetailOverlay({ taskKey, onClose }: Props) {
  const [leg, setLeg] = useState<Leg>({ state: 'loading', data: null, error: null })
  const [verbBusy, setVerbBusy] = useState<string | null>(null)
  const [verbMessage, setVerbMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Collapsed by default — this is the honesty a fresh critic found missing
  // (a closed issue showed zero verbs and zero reason, see
  // lib/issue-verbs.ts's `withheldIssueVerbs` header), not a promoted primary
  // action; the ready verbs above stay the fast path for the common case.
  const [showWithheld, setShowWithheld] = useState(false)

  const scopeProject = typeof window !== 'undefined' ? projectFromPath(window.location.pathname) : null

  const load = useCallback((key: string) => {
    setLeg({ state: 'loading', data: null, error: null })
    setVerbMessage(null)
    fetchJson<IssueRow>(`/api/issues?task_key=${encodeURIComponent(key)}`).then(r => {
      if (r.ok && r.data) {
        // Defense in depth only — see the file header. The authoritative 404
        // already happened server-side if this page's own path names a
        // different project than the row's.
        if (scopeProject && r.data.project && r.data.project !== scopeProject) {
          setLeg({ state: 'missing', data: null, error: null })
        } else {
          setLeg({ state: 'ok', data: r.data, error: null })
        }
      } else if (r.status === 404) {
        setLeg({ state: 'missing', data: null, error: null })
      } else {
        setLeg({ state: 'error', data: null, error: r.error })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })
  }, [scopeProject])

  useEffect(() => {
    if (!taskKey) return
    load(taskKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKey])

  useEffect(() => {
    if (!taskKey) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [taskKey, onClose])

  if (!taskKey) return null

  const scopeName = scopeProject ?? 'this project'
  const row = leg.data

  const copyLink = () => {
    const path = issuePermalinkPath(window.location.pathname, taskKey)
    const url = `${window.location.origin}${path}`
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const runVerb = async (verb: IssueVerb) => {
    if (!row) return
    setVerbBusy(verb.toStatus)
    setVerbMessage(null)
    const result = await runIssueVerb(row, verb.toStatus)
    setVerbBusy(null)
    if (result.ok) {
      setVerbMessage({ ok: true, text: `Moved ${taskKey} to ${verb.label.replace(/^(Move to|Send to)\s*/, '')}.` })
      load(taskKey)
    } else {
      setVerbMessage({ ok: false, text: result.message })
    }
  }

  const verbs = row ? readyIssueVerbs(row) : []
  const withheld = row ? withheldIssueVerbs(row) : []

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={`Issue ${taskKey}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[640px] mx-4 bg-[#111] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden max-h-[76vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06] shrink-0">
          <span className="text-[10px] font-mono text-white/45 shrink-0">{taskKey}</span>
          <span className="text-xs text-white/30 truncate flex-1">
            {row?.title ?? (leg.state === 'loading' ? 'Loading…' : '')}
          </span>
          <button
            onClick={copyLink}
            aria-label="Copy permalink"
            className="p-1.5 rounded hover:bg-white/[0.06] text-white/40 hover:text-white/70 flex items-center gap-1 text-[10px]"
          >
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={onClose} aria-label="Close issue" className="p-1.5 rounded hover:bg-white/[0.06] text-white/40 hover:text-white/70">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 flex-1">
          {leg.state === 'loading' && <div className="text-xs text-white/30 py-4">Resolving {taskKey}…</div>}

          {leg.state === 'error' && leg.error && <ApiErrorBanner error={leg.error} onRetry={() => load(taskKey)} />}

          {leg.state === 'missing' && (
            <div className="text-xs text-white/45 py-4">
              {taskKey} not found in {scopeName}.
            </div>
          )}

          {leg.state === 'ok' && row && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
                {[row.status?.replace(/_/g, ' '), row.type, row.priority, row.severity, row.assignee, row.sprint, row.project]
                  .filter(Boolean)
                  .map((v, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-white/[0.05]">{v}</span>
                  ))}
              </div>

              {row.description && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1">Description</div>
                  <p className="text-xs text-white/70 whitespace-pre-wrap">{row.description}</p>
                </div>
              )}

              {row.acceptance_criteria && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1">Acceptance criteria</div>
                  <p className="text-xs text-white/70 whitespace-pre-wrap">{row.acceptance_criteria}</p>
                </div>
              )}

              {row.implementation_notes && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1">Implementation notes</div>
                  <p className="text-xs text-white/70 whitespace-pre-wrap">{row.implementation_notes}</p>
                </div>
              )}

              {/* ── verbs: only moves lib/issue-moves.ts's own predicate already
                  proved this row can complete with nothing collected first —
                  see lib/issue-verbs.ts's header for what was measured. */}
              {verbs.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <div className="text-[10px] uppercase tracking-wider text-white/35 mb-2">
                    PATCH /api/issues — {taskKey}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {verbs.map(v => (
                      <button
                        key={v.toStatus}
                        onClick={() => runVerb(v)}
                        disabled={verbBusy !== null}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-40 text-white/75"
                      >
                        {verbBusy === v.toStatus ? 'Sending…' : v.label}
                      </button>
                    ))}
                  </div>
                  {verbMessage && (
                    <p className={`text-xs mt-2 ${verbMessage.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {verbMessage.text}
                    </p>
                  )}
                </div>
              )}

              {/* ── withheld moves: "Never hide it" (lib/issue-moves.ts's own
                  header). A closed issue used to show verbs.length === 0 and
                  stop there — no verb, no reason, nothing distinguishing
                  "closed and read-only" from "the palette has no opinion".
                  Every reason below is moveVerdict's own, unmodified. */}
              {withheld.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => setShowWithheld(v => !v)}
                    className="text-[10px] uppercase tracking-wider text-white/35 hover:text-white/55"
                  >
                    {showWithheld ? 'Hide' : 'Show'} {withheld.length} withheld move{withheld.length > 1 ? 's' : ''}
                  </button>
                  {showWithheld && (
                    <ul className="mt-2 space-y-1.5">
                      {withheld.map(w => (
                        <li key={w.toStatus} className="text-xs text-white/45">
                          <span className="text-white/60">{w.label}:</span> {w.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
