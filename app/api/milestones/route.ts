import { NextResponse } from 'next/server'
import { db, dbMissingEnv } from '@/lib/db'

export async function GET() {
  const missing = dbMissingEnv()
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Database is not configured. Missing: ${missing.join(', ')}.`, missingEnv: missing },
      { status: 503 },
    )
  }

  const { data, error } = await db()
    .from('milestones')
    .select('*')
    .order('project')
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}
