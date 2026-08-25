import { NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

export async function GET(req: Request) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { searchParams } = new URL(req.url)
  const business_id = searchParams.get('business_id')

  if (business_id) {
    const hub = getHubClient(business_id)
    const { data, error } = await hub.client.from('agents').select('*').eq('business_id', hub.businessId).order('created_at')
    if (error) return dbQueryErrorResponse(error, 'agents')
    return NextResponse.json(data)
  }

  // AGGREGATE QUERY: intentionally cross-hub, no business_id scope
  const db = createAdminClient()
  const { data, error } = await db.from('agents').select('*').order('created_at')
  if (error) return dbQueryErrorResponse(error, 'agents')
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json()
  const { business_id, name, adapter, model, api_key_enc, heartbeat_every, description } = body
  if (!business_id || !name) return NextResponse.json({ error: 'business_id and name required' }, { status: 400 })
  const hub = getHubClient(business_id)
  const { data, error } = await hub.client.from('agents')
    .insert({
      business_id,
      name,
      adapter: adapter || 'claude-code',
      model: model || 'anthropic/claude-sonnet-4-6',
      api_key_enc,
      heartbeat_every: heartbeat_every || '4h',
      description
    })
    .select().single()
  if (error) return dbQueryErrorResponse(error, 'agents')
  return NextResponse.json(data)
}
