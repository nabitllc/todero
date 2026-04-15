// /api/cron/pr-window — Vercel Cron target (7am + 7pm ET daily)
//
// Delegates to the PR window logic. When Mac Mini is running,
// the LaunchAgent fires config/scripts/pr-window.py directly.
// This route is the Vercel-native path.
//
// TODO: implement full PR window logic here (batch merge approved PRs).
// For now, returns 200 so Vercel cron doesn't error.

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

  // PR window logic lives in config/scripts/pr-window.py (Mac Mini).
  // Full JS implementation: TOD-XXX
  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    note: 'PR window delegated to Mac Mini LaunchAgent. Full Vercel implementation pending.',
  })
}
