// app/api/inbox/decisions/route.ts — approval-surface piece (Wave 6)
//
// GET the append-only decision record written by PATCH /api/inbox. This is
// the "and it is visible afterwards" half of "approve and reject must both
// persist and be visible afterwards": before migration 061 the only trace of
// a decision was the inbox row's own mutable status, and a REFUSED decision
// left no trace at all.
//
// Read-only on purpose. There is no POST/PATCH/DELETE here and there must
// never be one — `approval_decisions` has exactly one writer
// (app/api/inbox/route.ts) and adding a second way to write it would make
// "append-only" a comment rather than a property.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

// A decision list that Next cached at first render would keep showing an
// empty audit trail after decisions were made — the same staleness
// app/api/inbox/[id]/route.ts forces dynamic for.
export const dynamic = 'force-dynamic'

/**
 * GET /api/inbox/decisions[?project=X][&inbox_id=…][&limit=N]
 *
 * Always returns `{ data, total, has_more, scope }`. Unlike GET /api/inbox
 * there is no legacy bare-array shape to preserve — nothing consumed this
 * before it existed.
 *
 * `project` filters on the project column recorded AT DECISION TIME, not
 * re-resolved now. That is deliberate: re-resolving would silently rewrite
 * history whenever an issue moved project, and an audit trail whose answers
 * change is not one.
 */
export async function GET(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const url = new URL(req.url)
  const projectParam = url.searchParams.get('project')
  const inboxId = url.searchParams.get('inbox_id')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1), 200)

  // Same rule as GET /api/inbox: an empty project= is a caller bug, and
  // answering it fleet-wide would be a silent widening of scope.
  if (projectParam !== null && !projectParam.trim()) {
    return NextResponse.json(
      { error: 'project= was given but empty. Omit the parameter for every project, or pass a project name.' },
      { status: 400 },
    )
  }

  const db = createAdminClient()
  let query = db
    .from('approval_decisions')
    .select('*')
    .order('decided_at', { ascending: false })
    .limit(limit)

  if (projectParam) query = query.eq('project', projectParam.trim())
  if (inboxId) query = query.eq('inbox_id', inboxId)

  const { data, error } = await query
  // Includes the "table does not exist" case — dbQueryErrorResponse names the
  // table and the migrate command instead of returning an empty list that
  // would read as "no decisions have ever been made".
  if (error) return dbQueryErrorResponse(error, 'approval_decisions')

  const rows = (data ?? []) as unknown[]
  return NextResponse.json({
    data: rows,
    total: rows.length,
    has_more: rows.length >= limit,
    scope: { project: projectParam?.trim() ?? null, inbox_id: inboxId ?? null },
  })
}
