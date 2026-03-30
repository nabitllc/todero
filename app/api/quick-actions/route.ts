// INF-207: Quick-action floating button — API routes
import { NextRequest, NextResponse } from 'next/server'
import { listQuickActions, upsertQuickAction } from '@/lib/quick-actions'

export async function GET() {
  const actions = await listQuickActions()
  return NextResponse.json(actions)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { label, icon, action_type, payload, sort_order, enabled } = body

  if (!label || !action_type) {
    return NextResponse.json({ error: 'label and action_type are required' }, { status: 422 })
  }

  const { data, error } = await upsertQuickAction({
    label,
    icon: icon ?? '⚡',
    action_type,
    payload: payload ?? {},
    sort_order: sort_order ?? 99,
    enabled: enabled ?? true,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
