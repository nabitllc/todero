// Phase 4 (TOD-1514): openclaw CLI removed 2026-04-09.
// model-canary stub — forward prompt to /api/run-agent for real canary testing.
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'model-canary: openclaw CLI retired. Use /api/run-agent for agent testing.', phase: 7 },
    { status: 501 }
  )
}
