import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Opt out of static prerender — route reads DB at request time. (TOD-2296)
export const dynamic = 'force-dynamic'

function getSupabase() {
  return db()
}

function authOk(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_documents')
    .select('*')
    .eq('id', params.id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { content?: string; updated_by?: string }
  if (!body.content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('agent_documents')
    .update({ content: body.content, updated_by: body.updated_by ?? 'api', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
