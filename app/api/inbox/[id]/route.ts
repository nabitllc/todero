// TOD-1038: GET /api/inbox/:id — single inbox request lookup
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

/** GET /api/inbox/:id — fetch single request by id */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('inbox')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
