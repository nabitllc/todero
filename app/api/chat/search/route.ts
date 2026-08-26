import { NextRequest, NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbQueryErrorResponse, dbUnavailableResponse } from '@/lib/db-http'

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
  // `error` used to be destructured away and the result returned as
  // `data || []`, so a failed query answered HTTP 200 with an empty array --
  // "no messages match" and "the search did not run" were the same answer.
  // Its three sibling routes under app/api/chat all branch on `error`; this
  // one did not, and scripts/no-silent-empty.mjs cannot see it because that
  // guard scans client-side response-parsing loaders, not server routes.
  const { data, error } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, content, role, created_at')
    .ilike('content', `%${q}%`)
    .limit(20)
  if (error) return dbQueryErrorResponse(error, 'chat_messages')
  return NextResponse.json(data || [])
}
