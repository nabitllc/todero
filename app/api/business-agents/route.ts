import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const business_id = searchParams.get('business_id')
  let query = supabase.from('agents').select('*').order('created_at')
  if (business_id) query = query.eq('business_id', business_id)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { business_id, name, adapter, model, api_key_enc, heartbeat_every, description } = body
  if (!business_id || !name) return NextResponse.json({ error: 'business_id and name required' }, { status: 400 })
  const { data, error } = await supabase.from('agents')
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
