import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { CostSnapshot } from '@/lib/issues'

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// INF-204: Cost trend sparkline — return 7-day cost history from agent_memory
export async function GET() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Read stored daily cost snapshots from agent_memory
    const { data } = await supabase
      .from('agent_memory')
      .select('value, updated_at')
      .eq('key', 'daily_cost_snapshot')
      .order('updated_at', { ascending: false })
      .limit(7)

    // Build 7-day array (newest first, then reversed)
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
        days.push({ date: dateStr, cost: val.cost ?? 0, tokens: val.tokens ?? 0 })
      } else {
        days.push({ date: dateStr, cost: 0, tokens: 0 })
      }
    }

    return NextResponse.json(days, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    // Fallback: return synthetic 7-day data so the UI always renders
    const now = new Date()
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - (6 - i))
      return { date: d.toISOString().slice(0, 10), cost: 0, tokens: 0 }
    })
    return NextResponse.json(days, { headers: { 'Cache-Control': 'no-store' } })
  }
}
