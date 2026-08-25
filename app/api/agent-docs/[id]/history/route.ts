import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

// Opt out of static prerender — route reads DB at request time. (TOD-2296)
export const dynamic = 'force-dynamic'

function getSupabase() {
  return db()
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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
