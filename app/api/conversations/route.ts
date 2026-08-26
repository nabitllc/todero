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
 *
 * THE INBOUND WEBHOOK SHAPE, AND ITS AUTHENTICATION (TOD-2470)
 * --------------------------------------------------------------
 * This route IS the provider-agnostic inbound webhook shape: a future
 * provider adapter (still unchosen — see lib/conversations.ts's "Outbound
 * adapter seam") translates whatever its provider sends into
 * `{channel, contact, contact_name, body, external_id}` and POSTs it here.
 * `external_id` is the provider's own id for the event; supplying one that
 * was already recorded answers **200** with `duplicate: true` and the
 * ORIGINAL message, never a second row — a real webhook retries, and a
 * retried delivery must be a no-op, not a second customer message.
 *
 * Two credentials reach this door, checked in this order:
 *   1. `X-Todero-Conversations-Secret` — a secret owned ONLY by this piece
 *      (`lib/conversations.ts`'s `verifyWebhookSecret`), deliberately
 *      separate from `lib/internal-auth.ts`'s general internal secret. A
 *      request that presents this header and gets it WRONG is refused
 *      immediately with a 401 naming that fact — it never falls through to
 *      the RBAC check below, which would let a guessed secret be retried for
 *      free under a friendlier failure.
 *   2. No such header at all — the existing `projects:write` RBAC check
 *      (session cookie or `X-Agent-Role`), unchanged from before this secret
 *      existed.
 *
 * What this does NOT yet reach: `middleware.ts` (not owned by this piece)
 * gates every `/api/*` route on a session cookie or the GENERAL internal
 * secret before any handler runs at all, so a caller presenting ONLY the
 * conversations secret cannot reach this code path in a real deployment yet.
 * The exact one-line diff that would open it is in this piece's doc
 * (docs/rebuild/pieces/pieces7/conversations-transport.md) as a request, not
 * applied here — middleware.ts is shared by every route in this app and is
 * outside what this piece is allowed to touch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  INBOUND_KEYS,
  WEBHOOK_SECRET_HEADER,
  normalizeConversationRow,
  normalizeMessageRow,
  validateInbound,
  verifyWebhookSecret,
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

/**
 * The inbound door's actual work — shared by both auth paths (webhook secret
 * and RBAC) so the two credentials protect the SAME code rather than two
 * copies of it that could drift.
 */
async function handleInbound(req: NextRequest): Promise<NextResponse> {
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

  // IDEMPOTENCY: a provider's own event id, already recorded, is a REPLAY —
  // never a second customer message. Checked before anything else is written.
  // Two plain lookups rather than a joined query — this codebase's db seam
  // deliberately has no vendor "embedded resource" select string (see
  // lib/db/join.ts's header); a `.join()` runs AFTER the main query and
  // cannot filter BY the related row, so the scope check below reads the
  // matched message's own conversation and compares its project the same way
  // thread-access.ts's `loadThreadInScope` does — never adopting the row's
  // project AS the scope, only checking it against the one already resolved.
  if (inbound.external_id) {
    const { data: dupeRows, error: dupeError } = await db()
      .from('conversation_messages')
      .select(MESSAGE_COLUMNS)
      .eq('external_id', inbound.external_id)
      .limit(1)
    if (dupeError) return dbQueryErrorResponse(dupeError, 'conversation_messages')
    const dupeRow = Array.isArray(dupeRows) ? dupeRows[0] : dupeRows
    if (dupeRow) {
      const dupeMessage = normalizeMessageRow(dupeRow as Record<string, unknown>)
      const { data: dupeConvRows, error: dupeConvError } = await db()
        .from('conversations')
        .select(CONVERSATION_COLUMNS)
        .eq('id', dupeMessage.conversation_id)
        .limit(1)
      if (dupeConvError) return dbQueryErrorResponse(dupeConvError, 'conversations')
      const dupeConvRow = Array.isArray(dupeConvRows) ? dupeConvRows[0] : dupeConvRows
      const dupeConv = dupeConvRow ? normalizeConversationRow(dupeConvRow as Record<string, unknown>) : null
      // A duplicate whose thread belongs to a DIFFERENT project than the one
      // this request resolved is not "this project's" replay to report — an
      // external_id collision across projects would otherwise leak that a row
      // exists elsewhere, exactly the cross-project read thread-access.ts's
      // 404 stance refuses. Fall through and record a new message instead;
      // a colliding external_id across two providers/projects is vanishingly
      // unlikely and the safe failure mode is "insert", not "leak".
      if (dupeConv && dupeConv.project === project) {
        return NextResponse.json(
          { duplicate: true, created: false, conversation: dupeConv, message: dupeMessage },
          { status: 200 },
        )
      }
    }
  }

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
      external_id: inbound.external_id,
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
      duplicate: false,
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
}

/**
 * The two credentials that may open this door, in order:
 *
 *   1. `X-Todero-Conversations-Secret` matching `CONVERSATIONS_WEBHOOK_SECRET`
 *      — a future provider adapter's credential, and NOTHING else in this app
 *      accepts it. Present and WRONG is refused here, immediately, with a 401
 *      — it never falls through to permission #2 below, which would let a
 *      guessed secret be retried for free under a friendlier failure mode.
 *   2. Absent entirely — the pre-existing `projects:write` RBAC check
 *      (session cookie or `X-Agent-Role`), unchanged.
 */
export const POST = async (req: NextRequest): Promise<NextResponse | Response> => {
  const webhookAuth = verifyWebhookSecret(req.headers.get(WEBHOOK_SECRET_HEADER))

  if (webhookAuth.presented && !webhookAuth.valid) {
    return NextResponse.json(
      {
        error: 'invalid webhook secret',
        code: 'WEBHOOK_SECRET_INVALID',
        message: `the ${WEBHOOK_SECRET_HEADER} header was present and did not match — this request is refused, not passed through to any other check`,
      },
      { status: 401 },
    )
  }

  if (webhookAuth.presented && webhookAuth.valid) {
    return handleInbound(req)
  }

  return withPermission('projects:write', handleInbound)(req)
}
