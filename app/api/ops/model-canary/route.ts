// model-canary stub — use /api/run-agent for real canary testing.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'model-canary: use /api/run-agent for agent testing.' },
    { status: 501 }
  )
}
