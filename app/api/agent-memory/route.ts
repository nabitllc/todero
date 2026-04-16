import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent_id')
  const memoryType = req.nextUrl.searchParams.get('type')
  const date = req.nextUrl.searchParams.get('date')

  let query = supabase.from('agent_memory').select('*').order('updated_at', { ascending: false })
  if (agentId) query = query.eq('agent_id', agentId)
  if (memoryType) query = query.eq('memory_type', memoryType)
  if (date) query = query.eq('date_key', date)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ memory: data })
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    agent_id?: string; memory_type?: string; date_key?: string | null; content?: string
  }

  if (!body.agent_id || !body.memory_type || !body.content) {
    return NextResponse.json({ error: 'agent_id, memory_type, content are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('agent_memory')
    .upsert({
      agent_id: body.agent_id,
      memory_type: body.memory_type,
      date_key: body.date_key ?? null,
      content: body.content,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id,memory_type,date_key' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
