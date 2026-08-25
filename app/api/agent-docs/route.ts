import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Opt out of static prerender — route reads DB at request time. (TOD-2296)
export const dynamic = 'force-dynamic'

function getSupabase() {
  return db()
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase()
  const agentId = req.nextUrl.searchParams.get('agent_id')
  const docType = req.nextUrl.searchParams.get('doc_type')

  let query = supabase.from('agent_documents').select('id,agent_id,doc_type,slug,updated_at,updated_by').order('doc_type').order('slug')
  if (agentId) query = query.eq('agent_id', agentId)
  if (docType) query = query.eq('doc_type', docType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ docs: data })
}
