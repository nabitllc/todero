import { NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { data, error } = await getSupabase().from('businesses').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json()
  const { name, type, owner, status } = body
  const { data, error } = await getSupabase().from('businesses').insert({ name, type, owner, status }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
