import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      'https://twthgapiouiqhavrcnry.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabase
}

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')
  if (!q || q.length < 2) return NextResponse.json([])
  const { data } = await getSupabase()
    .from('chat_messages')
    .select('id, conversation_id, content, role, created_at')
    .ilike('content', `%${q}%`)
    .limit(20)
  return NextResponse.json(data || [])
}
