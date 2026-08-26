/**
 * POST /api/conversations/<id>/messages — append one message to a thread.
 *
 * THE ONE RULE THIS FILE ENFORCES
 * -------------------------------
 * An outbound message is created as a DRAFT. Always. The caller does not get to
 * choose: `state` is derived by `validateMessage()` in lib/conversations.ts from
 * the direction, and `state`/`approved_at`/`approved_by`/`sent_at`/`sent_via`
 * are refused as request keys with a 400 that names why each one is not the
 * caller's to set. There is no parameter, no header and no role that turns this
 * endpoint into a send.
 *
 * This is the "Grok Bot drafts while you are away" door. The approval door is
 * PATCH …/messages/<message_id>, it takes a different permission, and it is the
 * only way out of `draft`.
 *
 * WHY A DRAFT DOES NOT MOVE THE THREAD'S CLOCK
 * --------------------------------------------
 * `conversations.last_message_at` is advanced for an INBOUND message and, in the
 * sibling route, when a send is recorded. It is deliberately NOT advanced by a
 * draft: as far as the customer is concerned nothing has happened yet, and a
 * thread that jumped to the top of the list because an agent wrote something
 * nobody approved would report activity that did not occur.
 *
 * THREADING WITHIN ONE CONVERSATION (migration 070)
 * ----------------------------------------------------
 * `reply_to_message_id` is optional and, when present, must name a message
 * that ALREADY EXISTS in THIS SAME conversation — checked here with a plain
 * lookup (`.eq('conversation_id', conversation.id)`), not trusted from the
 * request. A caller naming a message from a different thread is refused a
 * 400 rather than silently creating a cross-thread reference: this endpoint
 * is already scoped to one conversation via `loadThreadInScope`, and letting
 * a reply point outside it would be a second, quieter way to leak across a
 * boundary the rest of this piece refuses to widen.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import { MESSAGE_KEYS, normalizeMessageRow, validateMessage } from '@/lib/conversations'
import { MESSAGE_COLUMNS, loadThreadInScope } from '../../thread-access'

export const dynamic = 'force-dynamic'

export const POST = withPermission(
  'projects:write',
  async (req: NextRequest, ctx?: { params?: Record<string, string> }): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const outcome = await loadThreadInScope(req, ctx?.params?.id ?? '')
    if ('refusal' in outcome) return outcome.refusal
    const { conversation } = outcome

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'body must be JSON', accepted: MESSAGE_KEYS }, { status: 400 })
    }

    const verdict = validateMessage(body)
    if (!verdict.ok) {
      return NextResponse.json(
        verdict.status === 400 ? { error: verdict.why, accepted: MESSAGE_KEYS } : { error: verdict.why },
        { status: verdict.status },
      )
    }

    if (verdict.value.reply_to_message_id) {
      const { data: replyRows, error: replyError } = await db()
        .from('conversation_messages')
        .select('id')
        .eq('id', verdict.value.reply_to_message_id)
        .eq('conversation_id', conversation.id)
        .limit(1)
      if (replyError) return dbQueryErrorResponse(replyError, 'conversation_messages')
      const replyRow = Array.isArray(replyRows) ? replyRows[0] : replyRows
      if (!replyRow) {
        return NextResponse.json(
          {
            error: `reply_to_message_id "${verdict.value.reply_to_message_id}" does not name a message in this conversation`,
          },
          { status: 400 },
        )
      }
    }

    const now = new Date().toISOString()
    const { data, error } = await db()
      .from('conversation_messages')
      .insert({
        conversation_id: conversation.id,
        direction: verdict.value.direction,
        // Derived, never taken from the request. See the header.
        state: verdict.value.state,
        body: verdict.value.body,
        author: verdict.value.author,
        created_at: now,
        reply_to_message_id: verdict.value.reply_to_message_id,
      })
      .select(MESSAGE_COLUMNS)

    if (error) return dbQueryErrorResponse(error, 'conversation_messages')

    if (verdict.value.direction === 'inbound') {
      const { error: touchError } = await db()
        .from('conversations')
        .update({ last_message_at: now, status: conversation.status === 'closed' ? 'open' : conversation.status })
        .eq('id', conversation.id)
      if (touchError) return dbQueryErrorResponse(touchError, 'conversations')
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return NextResponse.json({ error: 'the message was not returned after insert' }, { status: 500 })

    return NextResponse.json({ message: normalizeMessageRow(row as Record<string, unknown>) }, { status: 201 })
  },
)
