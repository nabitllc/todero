// TOD-1038: GET /api/inbox/:id — single inbox request lookup
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'

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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
