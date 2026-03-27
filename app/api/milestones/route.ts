import { NextResponse } from 'next/server'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

export async function GET() {
  const res = await fetch(`${SUPA_URL}/rest/v1/milestones?order=project,name&select=*`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
    next: { revalidate: 60 }
  })
  const data = await res.json()
  return NextResponse.json(data)
}
