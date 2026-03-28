import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')
  if (!q || q.length < 2) return NextResponse.json([])
  const { data } = await supabase
    .from('chat_messages')
    .select('id, conversation_id, content, role, created_at')
    .ilike('content', `%${q}%`)
    .limit(20)
  return NextResponse.json(data || [])
}
