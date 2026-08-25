// TOD-1038: GET /api/inbox/:id — single inbox request lookup
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

// This route reports a live decision (status/resolved_by/resolved_at) for one
// request. Without forcing dynamic rendering, Next can serve a cached
// first-seen snapshot forever — a denied or approved request would keep
// reading back as pending indefinitely.
export const dynamic = 'force-dynamic'

/** GET /api/inbox/:id — fetch single request by id */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('inbox')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return dbQueryErrorResponse(error, 'inbox')
  }

  return NextResponse.json(data)
}
