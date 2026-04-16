import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent_id')
  const docType = req.nextUrl.searchParams.get('doc_type')

  let query = supabase.from('agent_documents').select('id,agent_id,doc_type,slug,updated_at,updated_by').order('doc_type').order('slug')
  if (agentId) query = query.eq('agent_id', agentId)
  if (docType) query = query.eq('doc_type', docType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ docs: data })
}
