import { NextResponse } from 'next/server'
import { exec } from 'child_process'

export async function POST(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  if (secret !== 'kaos-internal-2026') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // Kill port 3000 occupant — note: this process will die too, LaunchAgent restarts it
  exec('/usr/sbin/lsof -ti :3000 | xargs kill -9', () => {})
  return NextResponse.json({ ok: true, message: 'Restarting...' })
}
