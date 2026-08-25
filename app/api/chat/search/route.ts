import { NextRequest, NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const q = new URL(req.url).searchParams.get('q')
  if (!q || q.length < 2) return NextResponse.json([])
  const { data } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, content, role, created_at')
    .ilike('content', `%${q}%`)
    .limit(20)
  return NextResponse.json(data || [])
}
