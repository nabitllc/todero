import { NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

export async function GET() {
  const { data, error } = await getSupabase().from('businesses').select('*').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { name, type, owner, status } = body
  const { data, error } = await getSupabase().from('businesses').insert({ name, type, owner, status }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
