/**
 * app/api/conversations/thread-access.ts — the scope gate every conversations
 * route goes through. Not a route: this file is a plain module colocated with
 * the routes that use it (no `route.ts` name, so Next.js creates no endpoint
 * for it).
 *
 * It exists so the boundary is written ONCE. Four handlers read a thread, and a
 * boundary re-implemented four times is a boundary that will hold in three
 * places — which is the exact shape of the nine cross-project leaks this rebuild
 * closed one round ago.
 *
 * THE TWO RULES, IN ONE PLACE
 *   1. The project comes from resolveScope() and nowhere else: middleware's
 *      `x-mc-project`, or an explicit `?project=`. Absent -> 400. Conflicting
 *      -> 409. There is no widening escape.
 *   2. A thread's OWN project is never used as the scope. It is compared
 *      against the resolved scope, and a mismatch is a 404 — otherwise any id
 *      would be a way to read across the boundary it sits inside, and the
 *      scope would be decided by the thing it constrains.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbQueryErrorResponse } from '@/lib/db-http'
import { normalizeConversationRow, resolveScope, type ConversationRow } from '@/lib/conversations'

export const CONVERSATION_COLUMNS =
  'id,project,channel,contact,contact_name,status,last_message_at,created_at'
export const MESSAGE_COLUMNS =
  'id,conversation_id,direction,state,body,author,created_at,approved_at,approved_by,sent_at,sent_via'

export type ScopeOutcome = { project: string } | { refusal: NextResponse }

/** Resolve the scope for a request, or the response that refuses it. */
export function scopeOrRefusal(req: NextRequest): ScopeOutcome {
  const verdict = resolveScope(
    req.headers.get('x-mc-project'),
    req.nextUrl.searchParams.get('project'),
  )
  if (verdict.ok) return { project: verdict.project }
  return {
    refusal: NextResponse.json(
      { error: verdict.error, message: verdict.message },
      { status: verdict.status },
    ),
  }
}

export type ThreadOutcome =
  | { conversation: ConversationRow; project: string }
  | { refusal: NextResponse }

/**
 * Load one thread, but only if the caller's resolved scope contains it.
 *
 * A thread in another project answers 404 — the same answer a nonexistent id
 * gets, and deliberately so: telling a caller that a thread exists but belongs
 * to someone else is itself a cross-project read. The message names the scope
 * the request was made from, so an operator can see WHY it was not found
 * instead of concluding the data is gone.
 */
export async function loadThreadInScope(req: NextRequest, id: string): Promise<ThreadOutcome> {
  const scope = scopeOrRefusal(req)
  if ('refusal' in scope) return scope
  const { project } = scope

  if (!id || id.trim().length === 0) {
    return { refusal: NextResponse.json({ error: 'a conversation id is required' }, { status: 400 }) }
  }

  const { data, error } = await db()
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', id)
    .limit(1)

  if (error) return { refusal: dbQueryErrorResponse(error, 'conversations') }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    return {
      refusal: NextResponse.json(
        { error: `no conversation "${id}" in ${project}` },
        { status: 404 },
      ),
    }
  }

  const conversation = normalizeConversationRow(row as Record<string, unknown>)
  if (conversation.project !== project) {
    return {
      refusal: NextResponse.json(
        {
          error: `no conversation "${id}" in ${project}`,
          message:
            'That conversation belongs to a different project. Scope is not widened by naming a row inside it — ' +
            'open the project it belongs to and ask from there.',
        },
        { status: 404 },
      ),
    }
  }

  return { conversation, project }
}
