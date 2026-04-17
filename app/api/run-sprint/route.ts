import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  // Delegate to the existing run-builder API which handles DoR gating + WIP limits
  const res = await fetch('http://localhost:3000/api/run-builder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_SECRET ?? 'kaos-internal-2026',
    },
  })

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json({ ok: false, message: data.message ?? 'Builder trigger failed' }, { status: res.status })
  }

  // Notify via /api/notify (fire and forget) — openclaw message replaced (TOD-1514)
  fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🏃 Sprint triggered from UI: ${data.task ?? 'builder task'} (${data.taskKey ?? ''})`,
      channels: ['discord-alerts'],
    }),
  }).catch(() => { /* non-critical */ })

  return NextResponse.json({ ok: true, ...data })
}
