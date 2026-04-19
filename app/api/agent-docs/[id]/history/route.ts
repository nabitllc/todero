import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
function getSupabase() {
  return createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_document_history')
    .select('id,changed_by,changed_at,content')
    .eq('document_id', params.id)
    .order('changed_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ history: data })
}
