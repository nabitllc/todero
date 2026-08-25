import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Opt out of static prerender — route reads DB at request time. (TOD-2296)
export const dynamic = 'force-dynamic'

function getSupabase() {
  return db()
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
