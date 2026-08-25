// app/api/heartbeat/budget-check/route.ts — TOD-771
//
// Checks Claude token/cost usage against monthly budget.
// If <20% of monthly budget remains (projected), creates an Inbox warning.
//
// Intended to be called by a cron/n8n heartbeat trigger.
// De-duplicates: skips if a pending budget_warning already exists from last 24h.

import { NextResponse } from 'next/server'
import { db, dbMissingEnv } from '@/lib/db'

const MONTHLY_BUDGET_USD = 200
const WARN_THRESHOLD = 0.20 // warn when <20% remaining

function parseBudgetFromPlan(plan: string): number {
  const match = plan.match(/\$(\d+(?:\.\d+)?)/)
  return match ? parseFloat(match[1]) : MONTHLY_BUDGET_USD
}

export async function GET() {
  const missing = dbMissingEnv()
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Database is not configured. Missing: ${missing.join(', ')}` },
      { status: 503 }
    )
  }

  // 1. Fetch current usage from /api/settings/usage
  let todayCost = 0
  let monthlyBudget = MONTHLY_BUDGET_USD
  let usageError: string | null = null

  try {
    const usageRes = await fetch('http://localhost:3000/api/settings/usage', {
      cache: 'no-store',
    })
    if (usageRes.ok) {
      const usage = await usageRes.json()
      todayCost = usage?.claude?.todayCost ?? 0
      monthlyBudget = parseBudgetFromPlan(usage?.claude?.plan ?? '')
    } else {
      usageError = `usage API returned ${usageRes.status}`
    }
  } catch (e: unknown) {
    usageError = e instanceof Error ? e.message : String(e)
  }

  // 2. Fetch 7-day cost history for a better monthly projection
  let sum7Days = 0
  let activeDays = 0

  try {
    const histRes = await fetch('http://localhost:3000/api/settings/cost-history', {
      cache: 'no-store',
    })
    if (histRes.ok) {
      const history: Array<{ date: string; cost: number; tokens: number }> = await histRes.json()
      sum7Days = history.reduce((acc, d) => acc + (d.cost ?? 0), 0)
      activeDays = history.filter(d => d.cost > 0).length
    }
  } catch {
    // Non-fatal — fall back to daily extrapolation
  }

  // 3. Calculate projected monthly cost
  let projectedMonthlyCost: number
  let method: string

  if (activeDays >= 3) {
    const avg = sum7Days / activeDays
    projectedMonthlyCost = avg * 30
    method = 'rolling_avg'
  } else {
    // Not enough history — extrapolate from today's cost
    projectedMonthlyCost = todayCost * 30
    method = 'daily_extrapolation'
  }

  const percentRemaining = (monthlyBudget - projectedMonthlyCost) / monthlyBudget
  const shouldWarn = percentRemaining < WARN_THRESHOLD

  const checkResult = {
    todayCost,
    sum7Days: +sum7Days.toFixed(4),
    projectedMonthlyCost: +projectedMonthlyCost.toFixed(2),
    monthlyBudget,
    percentRemaining: +percentRemaining.toFixed(4),
    shouldWarn,
    method,
    usageError,
    checkedAt: new Date().toISOString(),
  }

  if (!shouldWarn) {
    return NextResponse.json({ ...checkResult, action: 'none' })
  }

  // 4. Check for existing pending budget_warning within last 24 hours (de-dup)
  const supabase = db()

  const { data: existing } = await supabase
    .from('inbox')
    .select('id, created_at')
    .eq('type', 'budget_warning')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)

  if (existing && existing.length > 0) {
    const lastWarning = new Date(existing[0].created_at)
    const hoursSince = (Date.now() - lastWarning.getTime()) / (1000 * 60 * 60)
    if (hoursSince < 24) {
      return NextResponse.json({
        ...checkResult,
        action: 'skipped_duplicate',
        existingId: existing[0].id,
      })
    }
  }

  // 5. Create inbox warning entry
  const { data: entry, error: insertError } = await supabase
    .from('inbox')
    .insert({
      agent: 'heartbeat',
      type: 'budget_warning',
      context: {
        message: `Claude budget alert: ${(percentRemaining * 100).toFixed(1)}% remaining of $${monthlyBudget}/mo`,
        ...checkResult,
      },
    })
    .select('id')
    .single()

  if (insertError || !entry) {
    return NextResponse.json(
      { ...checkResult, action: 'error', error: insertError?.message ?? 'insert failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ...checkResult, action: 'warned', inboxId: entry.id })
}
