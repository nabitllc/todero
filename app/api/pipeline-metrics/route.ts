// TOD-2299 / TOD-2301: Aggregate pipeline health metrics.
//
// Answers "is the pipeline drifting?" at a glance, without scrolling Discord.
// Event-based pings (merge conflicts, build failures, rejections) leave no
// cumulative signal — a spike across days only shows up if someone remembers
// to count. This endpoint reads existing tables and returns 7d/30d counts.
//
// Signal derivation (all windows anchored to `now - window`):
//   prs_merged              = count(releases.created_at in window)
//   merge_conflicts         = count(issues.deployer_notes LIKE '%Branch-on-branch conflict%' AND updated_at in window)
//   build_failures          = count(issues.reviewer_notes LIKE '%Auto-release skipped%' AND updated_at in window)
//   review_rejections       = sum(issues.rejection_count where last_rejected_at in window)
//   avg_cycle_time_hours    = mean(completed_at - created_at) for issues with status released/closed completed in window
//   prs_closed_unmerged     = omitted from v1 (requires GitHub API round-trip; branch-janitor already reports)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

function supabaseAdmin() {
  return db()
}

type Window = '7d' | '30d'

function windowStart(window: Window): string {
  const days = window === '7d' ? 7 : 30
  const ms = Date.now() - days * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString()
}

export async function GET(req: NextRequest) {
  const windowParam = (req.nextUrl.searchParams.get('window') ?? '7d') as Window
  if (windowParam !== '7d' && windowParam !== '30d') {
    return NextResponse.json({ error: 'window must be 7d or 30d' }, { status: 400 })
  }
  const since = windowStart(windowParam)
  const sb = supabaseAdmin()

  // PRs merged = releases created in window
  const { count: prs_merged = 0 } = await sb
    .from('releases')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)

  // Merge conflicts: deployer left a "Branch-on-branch conflict" note during the window
  const { count: merge_conflicts = 0 } = await sb
    .from('issues')
    .select('id', { count: 'exact', head: true })
    .ilike('deployer_notes', '%Branch-on-branch conflict%')
    .gte('updated_at', since)

  // Build failures: monitor-pr-merge appended "Auto-release skipped" during window
  const { count: build_failures = 0 } = await sb
    .from('issues')
    .select('id', { count: 'exact', head: true })
    .ilike('reviewer_notes', '%Auto-release skipped%')
    .gte('updated_at', since)

  // Review rejections: sum of rejection_count over issues last rejected in window.
  // (Not perfect — captures the latest count per issue, not per-event increments,
  // but gives a usable drift signal since rejection_count only grows.)
  const { data: rejRows } = await sb
    .from('issues')
    .select('rejection_count')
    .gte('last_rejected_at', since)
    .gt('rejection_count', 0)
  const review_rejections = (rejRows ?? []).reduce(
    (sum, r) => sum + ((r.rejection_count as number) ?? 0),
    0
  )

  // Cycle time: issues completed in window, status in released/closed.
  const { data: cycleRows } = await sb
    .from('issues')
    .select('created_at, completed_at')
    .in('status', ['released', 'closed'])
    .gte('completed_at', since)
    .not('completed_at', 'is', null)
  const cycleHours = (cycleRows ?? []).map(r => {
    const a = new Date(r.created_at as string).getTime()
    const b = new Date(r.completed_at as string).getTime()
    return (b - a) / (1000 * 60 * 60)
  }).filter(h => Number.isFinite(h) && h >= 0)
  const avg_cycle_time_hours = cycleHours.length
    ? Math.round((cycleHours.reduce((s, h) => s + h, 0) / cycleHours.length) * 10) / 10
    : null

  return NextResponse.json({
    window: windowParam,
    prs_merged,
    merge_conflicts,
    build_failures,
    review_rejections,
    avg_cycle_time_hours,
    cycle_sample_size: cycleHours.length,
    generated_at: new Date().toISOString(),
  })
}
