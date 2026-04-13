import { NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const business_id = searchParams.get('business_id')

  if (business_id) {
    // Hub-scoped: business_id filter auto-injected by getHubClient
    const db = getHubClient(business_id)
    const { data, error } = await db.from('agents').select('*').order('created_at')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // AGGREGATE QUERY: intentionally cross-hub, no business_id scope
  const db = createAdminClient()
  const { data, error } = await db.from('agents').select('*').order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { business_id, name, adapter, model, api_key_enc, heartbeat_every, description } = body
  if (!business_id || !name) return NextResponse.json({ error: 'business_id and name required' }, { status: 400 })
  // Hub-scoped insert: business_id auto-injected
  const db = getHubClient(business_id)
  const { data, error } = await db.from('agents')
    .insert({
      name,
      adapter: adapter || 'claude-code',
      model: model || 'anthropic/claude-sonnet-4-6',
      api_key_enc,
      heartbeat_every: heartbeat_every || '4h',
      description
    })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
