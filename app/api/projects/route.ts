import { NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'
import type { DbJoin } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

/**
 * Each project carries the name of the business it belongs to. Declared as a
 * join on the seam rather than as an embedded-resource select string, so the
 * query means the same thing to every adapter: `{ ..., businesses: { name } }`.
 */
const BUSINESS_NAME: DbJoin = {
  table: 'businesses',
  columns: ['name'],
  localColumn: 'business_id',
}

export async function GET(req: Request) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { searchParams } = new URL(req.url)
  const business_id = searchParams.get('business_id')

  if (business_id) {
    const hub = getHubClient(business_id)
    const { data, error } = await hub.client.from('projects')
      .select('*')
      .join(BUSINESS_NAME)
      .eq('business_id', hub.businessId)
      .order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // AGGREGATE QUERY: intentionally cross-hub, no business_id scope
  const db = createAdminClient()
  const { data, error } = await db.from('projects')
    .select('*')
    .join(BUSINESS_NAME)
    .order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { business_id, name, description, repo_url } = await req.json()
  if (!business_id || !name) return NextResponse.json({ error: 'business_id and name required' }, { status: 400 })
  const hub = getHubClient(business_id)
  const { data, error } = await hub.client.from('projects')
    .insert({ business_id, name, description, repo_url, status: 'active' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
