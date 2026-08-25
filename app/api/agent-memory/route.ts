import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

// Opt out of static prerender — route reads DB at request time. (TOD-2296)
export const dynamic = 'force-dynamic'

function getSupabase() {
  return db()
}

export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const supabase = getSupabase()
  const agentId = req.nextUrl.searchParams.get('agent_id')
  const memoryType = req.nextUrl.searchParams.get('type')
  const date = req.nextUrl.searchParams.get('date')

  let query = supabase.from('agent_memory_files').select('*').order('updated_at', { ascending: false })
  if (agentId) query = query.eq('agent_id', agentId)
  if (memoryType) query = query.eq('memory_type', memoryType)
  if (date) query = query.eq('date_key', date)

  const { data, error } = await query.limit(100)
  if (error) return dbQueryErrorResponse(error, 'agent_memory_files')
  return NextResponse.json({ memory: data })
}

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const secret = process.env.CRON_SECRET
  const host = req.headers.get('host') || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (secret && !isLocalhost && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    agent_id?: string; memory_type?: string; date_key?: string | null; content?: string
  }

  if (!body.agent_id || !body.memory_type || !body.content) {
    return NextResponse.json({ error: 'agent_id, memory_type, content are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_memory_files')
    .upsert({
      agent_id: body.agent_id,
      memory_type: body.memory_type,
      date_key: body.date_key ?? null,
      content: body.content,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_id,memory_type,date_key' })
    .select()
    .single()

  if (error) return dbQueryErrorResponse(error, 'agent_memory_files')
  return NextResponse.json(data)
}
