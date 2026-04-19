import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  // Delegate to run-agent (run-builder was retired — run-agent is the canonical spawn path)
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/run-agent?agent=builder`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': process.env.INTERNAL_SECRET ?? 'kaos-internal-2026',
      },
      body: JSON.stringify({}),
    }
  )

  const data = await res.json()

  if (!res.ok) {
    return NextResponse.json({ ok: false, message: data.message ?? 'Builder trigger failed' }, { status: res.status })
  }

  // Notify via /api/notify (fire and forget)
  fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `🏃 Sprint triggered from UI: ${data.task?.title ?? 'builder task'} (${data.task?.taskKey ?? ''})`,
      channels: ['discord-alerts'],
    }),
  }).catch(() => { /* non-critical */ })

  return NextResponse.json({ ok: true, ...data })
}
