import { NextResponse } from 'next/server'
import { dbRestBase } from '@/lib/db/rest'

const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET() {
  const res = await fetch(`${dbRestBase()}/rest/v1/milestones?order=project,name&select=*`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
    next: { revalidate: 60 }
  })
  const data = await res.json()
  return NextResponse.json(data)
}
