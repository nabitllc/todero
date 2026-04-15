// /api/cron/sprint-cycle — Vercel Cron target (6:55am ET daily)
//
// Delegates to the sprint-cycle logic. When Mac Mini is running,
// the LaunchAgent fires this directly. This route is the Vercel-native path.
//
// TODO: implement full sprint cycle logic here (close outgoing sprint,
// open new sprint). For now, returns 200 as a no-op so Vercel cron
// doesn't error.

import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const host = req.headers.get('host') || ''
  const authHeader = req.headers.get('authorization')
  const authorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    host.includes('localhost') ||
    host.includes('.vercel.app')

  if (!authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Sprint cycle logic lives in config/scripts/sprint-cycle.sh (Mac Mini).
  // Full JS implementation: TOD-XXX
  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    note: 'Sprint cycle delegated to Mac Mini LaunchAgent. Full Vercel implementation pending.',
  })
}
