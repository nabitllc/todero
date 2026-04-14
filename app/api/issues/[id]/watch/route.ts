import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { watcherId } = await req.json().catch(() => ({}))
  if (!watcherId) return NextResponse.json({ error: 'watcherId required' }, { status: 400 })

  const db = createAdminClient()

  const { data: issue, error: fetchErr } = await db
    .from('issues')
    .select('watchers')
    .eq('id', params.id)
    .single()

  if (fetchErr || !issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

  const current: string[] = Array.isArray(issue.watchers) ? issue.watchers : []
  if (current.includes(watcherId)) return NextResponse.json({ watchers: current })

  const updated = [...current, watcherId]
  const { error: updateErr } = await db
    .from('issues')
    .update({ watchers: updated, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ watchers: updated })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { watcherId } = await req.json().catch(() => ({}))
  if (!watcherId) return NextResponse.json({ error: 'watcherId required' }, { status: 400 })

  const db = createAdminClient()

  const { data: issue, error: fetchErr } = await db
    .from('issues')
    .select('watchers')
    .eq('id', params.id)
    .single()

  if (fetchErr || !issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

  const current: string[] = Array.isArray(issue.watchers) ? issue.watchers : []
  const updated = current.filter(w => w !== watcherId)

  const { error: updateErr } = await db
    .from('issues')
    .update({ watchers: updated, updated_at: new Date().toISOString() })
    .eq('id', params.id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
  return NextResponse.json({ watchers: updated })
}
