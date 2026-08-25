import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { CostSnapshot } from '@/lib/issues'
import { dbUnavailableResponse } from '@/lib/db-http'

// INF-204: Cost trend sparkline — return 7-day cost history from agent_memory
export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  try {
    const supabase = db()

    // Read stored daily cost snapshots from agent_memory
    const { data, error } = await supabase
      .from('agent_memory')
      .select('value, updated_at')
      .eq('key', 'daily_cost_snapshot')
      .order('updated_at', { ascending: false })
      .limit(7)

    // TOD: kill-fake-infra-greens — a query error is not "zero days of
    // cost", it's "we don't know". Say so in a non-2xx body instead of
    // handing the UI seven flat zeros that render as a real quiet week.
    if (error) {
      return NextResponse.json({ error: `query failed: ${error.message}` }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
    }

    // Build 7-day array (newest first, then reversed). A day with no
    // stored snapshot is null — nothing measured that day — not 0.
    const now = new Date()
    const days: CostSnapshot[] = []

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const match = data?.find(row => {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
        return val?.date === dateStr
      })
      if (match) {
        const val = typeof match.value === 'string' ? JSON.parse(match.value) : match.value
        days.push({ date: dateStr, cost: typeof val.cost === 'number' ? val.cost : null, tokens: typeof val.tokens === 'number' ? val.tokens : null })
      } else {
        days.push({ date: dateStr, cost: null, tokens: null })
      }
    }

    return NextResponse.json(days, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    // TOD: kill-fake-infra-greens — this used to fall back to synthetic
    // seven-day $0.00 data "so the UI always renders". That rendered a
    // labelled, measured-looking chart from data nothing measured. An
    // unhandled error is real information; say so instead of inventing a
    // flat week.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
