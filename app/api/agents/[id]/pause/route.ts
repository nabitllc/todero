import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/agents/[id]/pause — toggle pause state
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await req.json()
    const paused = !!body.paused

    const supabase = db()
    const value = JSON.stringify({ paused, updated_at: new Date().toISOString() })

    const { error } = await supabase
      .from('agent_memory')
      .upsert(
        { agent_id: id, key: 'pause_state', value },
        { onConflict: 'agent_id,key' }
      )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, paused })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// GET /api/agents/[id]/pause — read pause state
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const supabase = db()

    const { data } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('agent_id', id)
      .eq('key', 'pause_state')
      .single()

    if (!data) return NextResponse.json({ paused: false })
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    return NextResponse.json({ paused: !!parsed?.paused })
  } catch {
    return NextResponse.json({ paused: false })
  }
}
