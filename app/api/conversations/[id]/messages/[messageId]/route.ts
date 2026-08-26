/**
 * PATCH /api/conversations/<id>/messages/<message_id> — the approval door.
 *
 *   { "action": "approve",     "approved_by": "<who>" }   draft    -> approved
 *   { "action": "record_send", "sent_via":    "<what>" }  approved -> sent
 *
 * "You approve; Todero sends." Those two edges are the entire state machine, and
 * `planTransition()` in lib/conversations.ts is the only thing that computes
 * them. There is no `draft -> sent` edge anywhere in this piece; an attempt gets
 * a 409 quoting the rule back.
 *
 * TWO PERMISSIONS, ON PURPOSE — AND WHAT THEY ACTUALLY SEPARATE
 * -------------------------------------------------------------
 * The handler is wrapped in `projects:write`: enough to append a message, and
 * enough to record a send a transport reports. `approve` then requires
 * `settings:write` ON TOP, and the pair separates exactly the two callers this
 * channel has:
 *
 *   an AGENT — reaches the API with `X-Agent-Role: member` plus the internal
 *     secret (lib/internal-auth.ts). `member` holds `projects:write` and NOT
 *     `settings:write` (lib/rbac-types.ts ROLE_PERMISSIONS), so the drafting bot
 *     can write a draft and is refused 403 the moment it tries to approve it.
 *     That refusal IS "Grok Bot drafts; you approve".
 *
 *   the HUMAN at the keyboard — a browser session. Worth stating plainly rather
 *     than implying something finer: lib/with-permission.ts's COOKIE_ROLE_MAP
 *     knows only `admin` and `viewer`, so ANY signed-in session on the owner
 *     password resolves to `admin` whatever the `mc-role` cookie says. `admin`
 *     holds `settings:write`. There is therefore no separation between "owner"
 *     and "admin" here to claim — the real, enforced line is human session vs
 *     agent role, and `viewer` (write-blocked by middleware.ts) vs both.
 *
 * THIS ENDPOINT DOES NOT SEND
 * ---------------------------
 * `record_send` RECORDS a send that something else performed and reported —
 * hence the mandatory `sent_via`, which names what carried it. Todero has no
 * WhatsApp or web transport; that decision has not been made, and this file
 * contains no outbound request to any customer channel. An approved message
 * therefore sits at `approved` until something outside Todero reports otherwise,
 * and the surface says exactly that rather than implying delivery.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission, resolveRole } from '@/lib/with-permission'
import { hasPermission } from '@/lib/rbac-types'
import { ACTION_KEYS, normalizeMessageRow, planTransition, validateAction } from '@/lib/conversations'
import { MESSAGE_COLUMNS, loadThreadInScope } from '../../../thread-access'

export const dynamic = 'force-dynamic'

/**
 * Approving is not merely a write. `member` — the role a drafting agent presents
 * — holds `projects:write` but not this, so the agent that wrote the draft
 * cannot be the thing that approves it.
 */
const APPROVE_PERMISSION = 'settings:write' as const

export const PATCH = withPermission(
  'projects:write',
  async (req: NextRequest, ctx?: { params?: Record<string, string> }): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const outcome = await loadThreadInScope(req, ctx?.params?.id ?? '')
    if ('refusal' in outcome) return outcome.refusal
    const { conversation } = outcome

    const messageId = ctx?.params?.messageId ?? ''
    if (!messageId) return NextResponse.json({ error: 'a message id is required' }, { status: 400 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'body must be JSON', accepted: ACTION_KEYS }, { status: 400 })
    }

    const request = validateAction(body)
    if (!request.ok) {
      return NextResponse.json(
        request.status === 400 ? { error: request.why, accepted: ACTION_KEYS } : { error: request.why },
        { status: request.status },
      )
    }

    if (request.value.action === 'approve') {
      const role = resolveRole(req)
      if (!role || !hasPermission(role, APPROVE_PERMISSION)) {
        return NextResponse.json(
          {
            error: 'forbidden',
            code: 'PERMISSION_DENIED',
            role: role ?? 'unauthenticated',
            required: APPROVE_PERMISSION,
            message:
              `missing permission: ${APPROVE_PERMISSION} is not granted to role "${role ?? 'unauthenticated'}". ` +
              'Drafting a reply and approving one are deliberately different rights.',
          },
          { status: 403 },
        )
      }
    }

    // The message must belong to THIS thread. Reading it by id alone would let a
    // message be approved through any thread the caller can see, including from
    // a project the message is not in.
    const { data: rows, error: readError } = await db()
      .from('conversation_messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', messageId)
      .eq('conversation_id', conversation.id)
      .limit(1)

    if (readError) return dbQueryErrorResponse(readError, 'conversation_messages')

    const row = Array.isArray(rows) ? rows[0] : rows
    if (!row) {
      return NextResponse.json(
        { error: `no message "${messageId}" in conversation "${conversation.id}"` },
        { status: 404 },
      )
    }
    const message = normalizeMessageRow(row as Record<string, unknown>)

    const now = new Date().toISOString()
    const plan = planTransition(message, request.value, now)
    if (!plan.ok) {
      return NextResponse.json(
        { error: plan.why, state: message.state, action: request.value.action },
        { status: plan.status },
      )
    }

    const { data: updated, error: updateError } = await db()
      .from('conversation_messages')
      .update({ ...plan.value })
      .eq('id', messageId)
      // Re-stating the current state in the WHERE clause makes the write a
      // compare-and-set: two operators clicking Approve at the same moment
      // produce one approval and one 409, not two approvals racing over the
      // same row.
      .eq('state', message.state)
      .select(MESSAGE_COLUMNS)

    if (updateError) return dbQueryErrorResponse(updateError, 'conversation_messages')

    const updatedRow = Array.isArray(updated) ? updated[0] : updated
    if (!updatedRow) {
      return NextResponse.json(
        {
          error: `the message changed state before this ${request.value.action} could be applied — re-read it and decide again`,
          state: message.state,
        },
        { status: 409 },
      )
    }

    // A recorded send is the moment the customer heard from us, so it — and
    // only it — advances the thread's clock. An approval does not: nothing has
    // reached the customer yet.
    if (plan.value.state === 'sent') {
      const { error: touchError } = await db()
        .from('conversations')
        .update({ last_message_at: now })
        .eq('id', conversation.id)
      if (touchError) return dbQueryErrorResponse(touchError, 'conversations')
    }

    return NextResponse.json({ message: normalizeMessageRow(updatedRow as Record<string, unknown>) })
  },
)
