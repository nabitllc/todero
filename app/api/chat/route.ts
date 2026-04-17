// Phase 4.2 (TOD-1514): OpenClaw gateway removed 2026-04-09. Chat backend offline.
// This route is stubbed until Phase 7 (Chat Rebuild) ships.
// Issue draft detection and Supabase session logic will be re-integrated in Phase 7.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(_req: NextRequest) {
  const encoder = new TextEncoder()
  // Return a proper SSE-formatted 501 so ChatTab doesn't hang waiting for stream
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(
        `data: ${JSON.stringify({ error: 'Chat backend offline — rebuilding in Phase 7', phase: 7 })}\n\n`
      ))
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
      c.close()
    }
  })
  return new Response(stream, {
    status: 200, // keep 200 so SSE client connects; error surfaced in stream
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
