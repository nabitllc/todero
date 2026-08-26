/**
 * GET /api/conversations/<id> — one thread, with every message in it.
 *
 * The scope check is the point of this file, and it runs BEFORE the thread is
 * returned: `loadThreadInScope()` compares the row's project against the scope
 * the request resolved and answers 404 when they differ. The thread's own
 * project is never adopted as the scope — a row cannot be the authority on the
 * boundary it sits inside.
 *
 * The message list is returned in creation order, states verbatim from the
 * `state` column. Nothing here infers a state from the presence of a timestamp:
 * a message is "sent" because the column says so, which — given migration 063's
 * CHECK constraints — cannot be true unless it was approved first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import { normalizeMessageRow } from '@/lib/conversations'
import { MESSAGE_COLUMNS, loadThreadInScope } from '../thread-access'

export const dynamic = 'force-dynamic'

export const GET = withPermission(
  'projects:read',
  async (req: NextRequest, ctx?: { params?: Record<string, string> }): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const outcome = await loadThreadInScope(req, ctx?.params?.id ?? '')
    if ('refusal' in outcome) return outcome.refusal
    const { conversation } = outcome

    const { data, error } = await db()
      .from('conversation_messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })

    if (error) return dbQueryErrorResponse(error, 'conversation_messages')

    const messages = (Array.isArray(data) ? data : []).map(row =>
      normalizeMessageRow(row as Record<string, unknown>),
    )

    // Counted from the rows just read, which ARE every message of this thread —
    // no limit was applied above, so these are not a page's worth.
    const counts = {
      messages: messages.length,
      awaiting_approval: messages.filter(m => m.state === 'draft').length,
      approved_not_sent: messages.filter(m => m.state === 'approved').length,
      sent: messages.filter(m => m.state === 'sent').length,
    }

    return NextResponse.json({ conversation, messages, counts })
  },
)
