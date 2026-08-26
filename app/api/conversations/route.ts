/**
 * app/api/conversations — customer conversation threads, scoped to one project.
 *
 *   GET  /api/conversations[?project=<name>]  -> { project, conversations, counts }
 *   POST /api/conversations[?project=<name>]  -> 201 { created, conversation, message }
 *
 * GET lists the threads for the resolved project. POST is the INBOUND door: a
 * customer message arriving, which opens a thread or joins the existing one.
 * There is no outbound path here — an outbound reply is appended to a thread
 * through …/[id]/messages, and it is always created as a draft.
 *
 * SCOPE — fail closed, and never widen.
 * -------------------------------------
 * `lib/conversations.ts` resolveScope() is the only place the project comes
 * from: middleware.ts's `x-mc-project` (which a caller cannot forge — see that
 * file's block comment), or an explicit `?project=` for a caller with no page
 * context. Neither present is a 400 that says how to ask deliberately; both
 * present and disagreeing is a 409. There is deliberately NO `all_projects=1`
 * escape: unlike issues, which have genuinely cross-project screens (Fleet,
 * Runs, settings/projects), a customer conversation belongs to exactly one
 * project and no screen in this product shows two projects' customers together.
 *
 * VALIDATION — copied from app/api/hub-settings/route.ts.
 * ------------------------------------------------------
 * An unknown key is REFUSED with a 400 that names the accepted ones. It is never
 * stored and never quietly dropped. The lifecycle keys (`state`, `approved_at`,
 * `approved_by`, `sent_at`, `sent_via`) get their own refusal naming why they
 * are not the caller's to set.
 *
 * COUNTS ARE EXACT, OR THEY ARE NOT SHOWN.
 * ----------------------------------------
 * Every number in the response comes from a `count: 'exact'` query, never from
 * the length of a page. Where a per-thread breakdown could have been truncated,
 * the response says so (`drafts_complete: false`) instead of shipping a number
 * that is quietly short.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  INBOUND_KEYS,
  normalizeConversationRow,
  normalizeMessageRow,
  validateInbound,
} from '@/lib/conversations'
import { CONVERSATION_COLUMNS, MESSAGE_COLUMNS, scopeOrRefusal } from './thread-access'

export const dynamic = 'force-dynamic'

/** How many threads one page of the list carries. */
const THREAD_PAGE = 200
/** How many draft rows the per-thread breakdown is willing to read. */
const DRAFT_SCAN = 1000

export const GET = withPermission(
  'projects:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const scope = scopeOrRefusal(req)
    if ('refusal' in scope) return scope.refusal
    const { project } = scope

    // Newest activity first. `nullsFirst: false` keeps a thread that has never
    // received a message at the BOTTOM rather than at the top, which is where
    // "sort by last_message_at DESC" would otherwise put a NULL in Postgres.
    const {
      data: rows,
      error,
      count: threadsTotal,
    } = await db()
      .from('conversations')
      .select(CONVERSATION_COLUMNS, { count: 'exact' })
      .eq('project', project)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(THREAD_PAGE)

    if (error) return dbQueryErrorResponse(error, 'conversations')

    const conversations = (Array.isArray(rows) ? rows : []).map(r =>
      normalizeConversationRow(r as Record<string, unknown>),
    )
    const ids = conversations.map(c => c.id)

    // Both totals are real COUNT(*)s over THIS project's threads. `.in()` with
    // an empty array compiles to FALSE (lib/db/pg-sql.ts), so a project with no
    // threads answers 0 rather than counting every project's drafts.
    const [{ count: awaiting, error: awaitingError }, { count: sent, error: sentError }] = await Promise.all([
      db().from('conversation_messages').select('id', { count: 'exact', head: true }).in('conversation_id', ids).eq('state', 'draft'),
      db().from('conversation_messages').select('id', { count: 'exact', head: true }).in('conversation_id', ids).eq('state', 'sent'),
    ])
    if (awaitingError) return dbQueryErrorResponse(awaitingError, 'conversation_messages')
    if (sentError) return dbQueryErrorResponse(sentError, 'conversation_messages')

    // Per-thread pending counts, tallied from the draft rows themselves.
    const { data: draftRows, error: draftError } = await db()
      .from('conversation_messages')
      .select('conversation_id')
      .in('conversation_id', ids)
      .eq('state', 'draft')
      .limit(DRAFT_SCAN)
    if (draftError) return dbQueryErrorResponse(draftError, 'conversation_messages')

    const drafts = Array.isArray(draftRows) ? draftRows : []
    const pending = new Map<string, number>()
    for (const row of drafts) {
      const id = String((row as Record<string, unknown>).conversation_id ?? '')
      pending.set(id, (pending.get(id) ?? 0) + 1)
    }
    // The tally is only complete when every draft the exact count knows about
    // was actually read. Short of that the per-thread numbers would be quietly
    // wrong, so they are withheld and the response says which case it is.
    const draftsComplete = typeof awaiting === 'number' ? drafts.length === awaiting : false

    return NextResponse.json({
      project,
      conversations: conversations.map(c => ({
        ...c,
        awaiting_approval: draftsComplete ? pending.get(c.id) ?? 0 : null,
      })),
      counts: {
        threads_listed: conversations.length,
        threads_total: typeof threadsTotal === 'number' ? threadsTotal : null,
        awaiting_approval: typeof awaiting === 'number' ? awaiting : null,
        sent: typeof sent === 'number' ? sent : null,
      },
      drafts_complete: draftsComplete,
    })
  },
)

export const POST = withPermission(
  'projects:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const scope = scopeOrRefusal(req)
    if ('refusal' in scope) return scope.refusal
    const { project } = scope

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'body must be JSON', accepted: INBOUND_KEYS }, { status: 400 })
    }

    const verdict = validateInbound(body)
    if (!verdict.ok) {
      return NextResponse.json(
        verdict.status === 400 ? { error: verdict.why, accepted: INBOUND_KEYS } : { error: verdict.why },
        { status: verdict.status },
      )
    }
    const inbound = verdict.value
    const now = new Date().toISOString()

    // One thread per (project, channel, contact) — migration 063's UNIQUE.
    // "A reply threads instead of drowning the channel": the second message
    // from a contact joins the row below, it does not open a second one.
    const { data: existingRows, error: findError } = await db()
      .from('conversations')
      .select(CONVERSATION_COLUMNS)
      .eq('project', project)
      .eq('channel', inbound.channel)
      .eq('contact', inbound.contact)
      .limit(1)
    if (findError) return dbQueryErrorResponse(findError, 'conversations')

    let conversation = Array.isArray(existingRows) && existingRows[0]
      ? normalizeConversationRow(existingRows[0] as Record<string, unknown>)
      : null
    const created = conversation === null

    if (!conversation) {
      const { data: inserted, error: insertError } = await db()
        .from('conversations')
        .insert({
          project,
          channel: inbound.channel,
          contact: inbound.contact,
          contact_name: inbound.contact_name,
          status: 'open',
          last_message_at: now,
          created_at: now,
        })
        .select(CONVERSATION_COLUMNS)
      if (insertError) return dbQueryErrorResponse(insertError, 'conversations')
      const row = Array.isArray(inserted) ? inserted[0] : inserted
      if (!row) {
        return NextResponse.json({ error: 'the conversation was not returned after insert' }, { status: 500 })
      }
      conversation = normalizeConversationRow(row as Record<string, unknown>)
    }

    const { data: messageRows, error: messageError } = await db()
      .from('conversation_messages')
      .insert({
        conversation_id: conversation.id,
        direction: 'inbound',
        state: 'received',
        body: inbound.body,
        author: null,
        created_at: now,
      })
      .select(MESSAGE_COLUMNS)
    if (messageError) return dbQueryErrorResponse(messageError, 'conversation_messages')

    // The thread's clock moves because a customer wrote — and a closed thread
    // reopens for the same reason. A contact who writes again has not been
    // dealt with, whatever the last operator concluded.
    const { error: touchError } = await db()
      .from('conversations')
      .update({ last_message_at: now, status: conversation.status === 'closed' ? 'open' : conversation.status })
      .eq('id', conversation.id)
    if (touchError) return dbQueryErrorResponse(touchError, 'conversations')

    const messageRow = Array.isArray(messageRows) ? messageRows[0] : messageRows

    return NextResponse.json(
      {
        created,
        conversation: {
          ...conversation,
          last_message_at: now,
          status: conversation.status === 'closed' ? 'open' : conversation.status,
        },
        message: messageRow ? normalizeMessageRow(messageRow as Record<string, unknown>) : null,
      },
      { status: 201 },
    )
  },
)
