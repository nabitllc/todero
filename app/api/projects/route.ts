import { NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const business_id = searchParams.get('business_id')

  if (business_id) {
    const hub = getHubClient(business_id)
    const { data, error } = await hub.client.from('projects').select('*, businesses(name)').eq('business_id', hub.businessId).order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // AGGREGATE QUERY: intentionally cross-hub, no business_id scope
  const db = createAdminClient()
  const { data, error } = await db.from('projects').select('*, businesses(name)').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const { business_id, name, description, repo_url } = await req.json()
  if (!business_id || !name) return NextResponse.json({ error: 'business_id and name required' }, { status: 400 })
  const hub = getHubClient(business_id)
  const { data, error } = await hub.client.from('projects')
    .insert({ business_id, name, description, repo_url, status: 'active' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
