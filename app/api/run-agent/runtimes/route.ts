// TOD-793: Runtime registry view — lists registered runtimes and availability.
// Used by smoke tests and future UI to show "which runtimes can we dispatch to".
import { NextResponse } from 'next/server'
import { listRuntimes } from '@/lib/runtimes'

export async function GET() {
  const runtimes = await listRuntimes()
  return NextResponse.json({
    runtimes,
    default: process.env.TODERO_RUNTIME ?? 'claude-code',
    count: runtimes.length,
    availableCount: runtimes.filter(r => r.available).length,
  })
}
