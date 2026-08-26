'use client'

// components/tabs/ConversationsTab.tsx — customer-conversations piece.
//
// The Customer Conversations channel scored 0/9 with the note "no conversation
// store, no draft-approve-send path, no channel integration". This is the
// surface half of the fix, built on components/nav/Card.tsx so it inherits the
// card contract rather than inventing its own chrome:
//
//   one question as the title ...... "Who is waiting on a reply?"
//   one number from a real query ... drafts awaiting approval, count:'exact'
//   the query printed as `source` .. the literal endpoint that produced it
//   an empty state naming the project
//   an error that REPLACES the body
//
// WHAT THIS SURFACE WILL NOT DO
// -----------------------------
// There is no Send button, and there is no code path here that sends. The
// owner's rule is "You approve; Todero sends" and only the first half exists
// today: Todero has no WhatsApp or web transport, that decision has not been
// made, and a button that pretended otherwise would be a bigger lie than the
// empty screen it replaced. An approved reply therefore renders as approved and
// waiting, with the reason stated on the row.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'
import { formatAgo } from '@/lib/time'
import { sessionOperator } from '@/lib/operator-identity'
import {
  conversationsQuery,
  describeMessageState,
  emptyConversationsMessage,
  type ConversationRow,
  type MessageRow,
} from '@/lib/conversations'

interface ListedThread extends ConversationRow {
  /** null when the server could not tally per-thread drafts completely. */
  awaiting_approval: number | null
}

interface ListPayload {
  project: string
  conversations: ListedThread[]
  counts: {
    threads_listed: number
    threads_total: number | null
    awaiting_approval: number | null
    sent: number | null
  }
  drafts_complete: boolean
}

interface ThreadPayload {
  conversation: ConversationRow
  messages: MessageRow[]
}

export interface ConversationsTabProps {
  /** Project scope. Null means the app has not resolved one yet. */
  projectFilter: string | null
}

export default function ConversationsTab({ projectFilter }: ConversationsTabProps) {
  const [list, setList] = useState<ListPayload | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadPayload | null>(null)
  const [threadError, setThreadError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const query = projectFilter ? conversationsQuery(projectFilter) : null

  const load = useCallback(async () => {
    if (!query) return
    try {
      const res = await fetch(query)
      if (!res.ok) {
        setError(await readApiError(res, '/api/conversations'))
        setList(null)
        return
      }
      setList((await res.json()) as ListPayload)
      setError(null)
    } catch (e) {
      setList(null)
      setError({
        status: 0,
        endpoint: '/api/conversations',
        message: e instanceof Error ? e.message : 'could not reach the server',
      })
    }
  }, [query])

  const loadThread = useCallback(async (id: string) => {
    const endpoint = `/api/conversations/${encodeURIComponent(id)}`
    try {
      const res = await fetch(endpoint)
      if (!res.ok) {
        setThreadError(await readApiError(res, endpoint))
        setThread(null)
        return
      }
      setThread((await res.json()) as ThreadPayload)
      setThreadError(null)
    } catch (e) {
      setThread(null)
      setThreadError({ status: 0, endpoint, message: e instanceof Error ? e.message : 'could not reach the server' })
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (openId) void loadThread(openId) }, [openId, loadThread])

  /** The one write this surface performs. It approves; it never sends. */
  const approve = useCallback(async (conversationId: string, messageId: string, approver: string) => {
    const endpoint = `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`
    setBusy(messageId)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve', approved_by: approver }),
      })
      if (!res.ok) {
        setThreadError(await readApiError(res, endpoint))
        return
      }
      setThreadError(null)
      await loadThread(conversationId)
      await load()
    } catch (e) {
      setThreadError({ status: 0, endpoint, message: e instanceof Error ? e.message : 'could not reach the server' })
    } finally {
      setBusy(null)
    }
  }, [load, loadThread])

  const source = query
    ? `${query}${openId ? ` · /api/conversations/${openId}` : ''}`
    : '/api/conversations — waiting for a project scope'

  if (!projectFilter) {
    return (
      <Card
        id="conversations"
        title="Who is waiting on a reply?"
        source={source}
        empty={{ active: true, message: 'No project selected yet, so there is no conversation scope to read.' }}
      />
    )
  }

  // An error REPLACES the body. An empty state rendered over a refused request
  // would tell the operator no customer is waiting when the truth is nobody
  // asked.
  if (error) {
    return (
      <Card id="conversations" title="Who is waiting on a reply?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  const counts = list?.counts
  const awaiting = counts?.awaiting_approval ?? null
  const threadsTotal = counts?.threads_total ?? null
  const operator = sessionOperator()

  return (
    <Card
      id="conversations"
      title="Who is waiting on a reply?"
      source={source}
      // No placeholder 0 while the count is in flight — the metric is omitted
      // entirely until a real number arrives.
      metric={awaiting === null ? undefined : { value: awaiting, label: 'awaiting approval', tone: awaiting > 0 ? 'amber' : 'default' }}
      empty={threadsTotal === 0 ? { active: true, message: emptyConversationsMessage(projectFilter) } : undefined}
    >
      <div className="space-y-2">
        {(list?.conversations ?? []).map(c => (
          <div key={c.id} className="rounded-xl border border-white/10">
            <button
              onClick={() => setOpenId(prev => (prev === c.id ? null : c.id))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
              aria-expanded={openId === c.id}
            >
              <span className="text-white text-xs font-medium truncate">{c.contact_name ?? c.contact}</span>
              <span className="text-white/40 text-[10px] font-mono uppercase shrink-0">{c.channel}</span>
              <span className="text-white/40 text-[10px] shrink-0">{c.status}</span>
              <span className="flex-1" />
              {c.awaiting_approval !== null && c.awaiting_approval > 0 && (
                <span className="text-amber-400 text-[10px] font-mono shrink-0">{c.awaiting_approval} to approve</span>
              )}
              <span className="text-white/35 text-[10px] font-mono shrink-0">
                {c.last_message_at ? formatAgo(c.last_message_at) : 'no messages yet'}
              </span>
            </button>

            {openId === c.id && (
              <div className="px-3 pb-3 space-y-2 border-t border-white/10 pt-2">
                {threadError ? (
                  <ApiErrorBanner error={threadError} onRetry={() => void loadThread(c.id)} />
                ) : (
                  (thread?.conversation.id === c.id ? thread.messages : []).map(m => {
                    const described = describeMessageState(m)
                    return (
                      <div key={m.id} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-white/40 font-mono text-[10px] uppercase">{m.direction}</span>
                          <span className="text-white/70 text-[10px]">{described.label}</span>
                          <span className="text-white/30 font-mono text-[10px]">{formatAgo(m.created_at)}</span>
                          {m.state === 'draft' && operator && (
                            <button
                              disabled={busy === m.id}
                              onClick={() => void approve(c.id, m.id, operator)}
                              className="ml-auto text-[10px] px-2 py-0.5 rounded-md border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40"
                            >
                              {busy === m.id ? 'Approving…' : 'Approve'}
                            </button>
                          )}
                          {m.state === 'draft' && !operator && (
                            <span className="ml-auto text-white/35 text-[10px]">
                              approving needs the owner role
                            </span>
                          )}
                        </div>
                        <p className="text-white/80 mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
                        {described.note && <p className="text-white/35 text-[10px] mt-0.5">{described.note}</p>}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        ))}

        {/* Both numbers below are the server's own counts, not the length of
            what happens to be rendered above. */}
        {counts && (
          <p className="text-white/35 text-[10px] font-mono">
            {threadsTotal ?? '—'} thread{threadsTotal === 1 ? '' : 's'} in {projectFilter}
            {' · '}
            {counts.sent ?? '—'} repl{counts.sent === 1 ? 'y' : 'ies'} recorded as sent
            {!list?.drafts_complete && ' · per-thread counts withheld: more drafts than one page'}
          </p>
        )}
      </div>
    </Card>
  )
}
