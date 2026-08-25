import { NextResponse } from 'next/server'
import { db, dbMissingEnv } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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
