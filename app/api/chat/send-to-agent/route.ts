// Phase 4.2 (TOD-1514): OpenClaw gateway removed 2026-04-09. Chat backend offline.
// This route is stubbed until Phase 7 (Chat Rebuild) ships.
import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Chat backend offline — rebuilding in Phase 7', phase: 7 },
    { status: 501 }
  )
}
