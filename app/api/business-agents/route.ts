import { NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { resolveConfiguredModel } from '@/lib/llm-provider'

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
  // Same rule as /api/onboarding: an agent may only be stamped with a model
  // the configured endpoint reports. The old `|| 'anthropic/claude-sonnet-4-6'`
  // wrote a cloud id into every agent created without an explicit model.
  const resolved = await resolveConfiguredModel(model)
  if (!resolved.ok) {
    // `kind` rides along so a client can tell "the LLM host is down" (retry)
    // from "LLM_BASE_URL points at the wrong kind of server" (fix the config)
    // without string-matching prose. Absent when resolveConfiguredModel had no
    // fetch failure to classify (an unknown model id, an empty roster).
    return NextResponse.json({ error: resolved.error, id: resolved.id, kind: resolved.kind }, { status: resolved.status })
  }
  const hub = getHubClient(business_id)
  const { data, error } = await hub.client.from('agents')
    .insert({
      business_id,
      name,
      adapter: adapter || 'claude-code',
      model: resolved.model,
      api_key_enc,
      heartbeat_every: heartbeat_every || '4h',
      description
    })
    .select().single()
  if (error) return dbQueryErrorResponse(error, 'agents')
  return NextResponse.json(data)
}
