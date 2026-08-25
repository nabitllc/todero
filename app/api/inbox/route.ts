// TOD-762: inbox_requests API route — GET list, POST create, PATCH resolve
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

/** GET /api/inbox?status=pending — list inbox requests */
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)

  const db = createAdminClient()
  let query = db
    .from('inbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return dbQueryErrorResponse(error, 'inbox')
  return NextResponse.json(data)
}

/** POST /api/inbox — create approval request */
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as {
    agent?: string
    type?: string
    context?: unknown
    expires_at?: string
    issue_id?: string
  }

  if (!body.agent || !body.type) {
    return NextResponse.json({ error: 'agent and type are required' }, { status: 400 })
  }

  // Same reasoning as PATCH below: `issue_id` shipped in migration 022, so
  // always sending `issue_id: null` broke creation on an install that has
  // only run 011 — the write named a column that doesn't exist there yet,
  // even for requests that never wanted to link an issue at all.
  const row: Record<string, unknown> = {
    agent: body.agent,
    type: body.type,
    context: body.context ?? null,
    expires_at: body.expires_at ?? null,
  }
  if (body.issue_id !== undefined) row.issue_id = body.issue_id

  const db = createAdminClient()
  let { data, error } = await db.from('inbox').insert(row).select().single()

  let issueIdDropped = false
  if (error?.code === 'PGRST204' && 'issue_id' in row) {
    issueIdDropped = true
    const { issue_id: _dropped, ...withoutIssueId } = row
    ;({ data, error } = await db.from('inbox').insert(withoutIssueId).select().single())
  }

  if (error) return dbQueryErrorResponse(error, 'inbox')
  return NextResponse.json(
    issueIdDropped
      ? { ...data, _warning: 'issue_id not persisted — database schema is missing that column (run: npm run db:migrate)' }
      : data,
    { status: 201 },
  )
}

/** PATCH /api/inbox — resolve a request (approve / deny / explain) */
export async function PATCH(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as {
    id?: string
    status?: string
    resolved_by?: string
    response_data?: unknown
  }

  if (!body.id || !body.status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
  }

  const allowed = ['approved', 'denied', 'explained', 'timeout']
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${allowed.join(', ')}` },
      { status: 400 }
    )
  }

  // Only write columns this request actually supplied. `response_data` (and
  // `issue_id`) shipped in migration 022 — an install that has run 011 but
  // not 022 has a real `inbox` table missing only those columns, and always
  // writing `response_data: null` turned every approve/deny into an UPDATE
  // that names a column Postgres doesn't have, which read back as "table
  // does not exist" (db-http.ts's missing-table regex also matches a
  // missing-COLUMN message) even though the write path itself was fine.
  // The decision — who, when, what happened — always persists via
  // status/resolved_by/resolved_at, which have existed since 011.
  const updates: Record<string, unknown> = {
    status: body.status,
    resolved_by: body.resolved_by ?? 'user',
    resolved_at: new Date().toISOString(),
  }
  if (body.response_data !== undefined) updates.response_data = body.response_data

  const db = createAdminClient()
  let { data, error } = await db
    .from('inbox')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  // PGRST204: PostgREST's schema cache has no `response_data` column for
  // `inbox` — an install whose live database ran migration 011 but not 022
  // (response_data/issue_id). The decision itself — status, who, when — must
  // still land; only the optional "what happened as a result" payload is
  // unavailable here. Retry without it rather than losing the whole write.
  let responseDataDropped = false
  if (error?.code === 'PGRST204' && 'response_data' in updates) {
    responseDataDropped = true
    const { response_data: _dropped, ...withoutResponseData } = updates
    ;({ data, error } = await db
      .from('inbox')
      .update(withoutResponseData)
      .eq('id', body.id)
      .select()
      .single())
  }

  if (error) {
    // A well-formed request against an id that does not exist must be a 4xx,
    // not a 500 — `.single()` reports "0 rows" the same way whether the
    // predicate matched nothing or (in principle) too much.
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'inbox request not found' }, { status: 404 })
    }
    return dbQueryErrorResponse(error, 'inbox')
  }
  return NextResponse.json(
    responseDataDropped
      ? { ...data, _warning: 'response_data not persisted — database schema is missing that column (run: npm run db:migrate)' }
      : data,
  )
}
