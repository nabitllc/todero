// /api/cron/queue-refill — Vercel Cron target (every 30 min, :00 and :30)
//
// Maintains a minimum queue depth of 5 open issues per type per project.
// Pulls from refined when below threshold. Zero LLM tokens — pure API calls.
//
// Transition priority order (per user spec):
//   1. Issues whose parent is status='underway'
//   2. Priority (critical > high > medium > low)
//   3. due_date ASC (nulls last)
//   4. created_at ASC
//
// Replaces PO's manual refined→open step. PO now focuses solely on
// backlog→refined refinement.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get('authorization')
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) return true
  const host = req.headers.get('host') || ''
  return host.includes('localhost') || host.includes('.vercel.app')
}

const QUEUE_MIN = 5
const TYPES = ['task', 'bug', 'research', 'ops'] as const
type IssueType = typeof TYPES[number]

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 1, high: 2, medium: 3, low: 4,
}

interface RefinedIssue {
  id: string
  task_key: string
  type: string
  priority: string
  due_date: string | null
  created_at: string
  parent_id: string | null
  assignee: string | null
  owner: string | null
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // ── Fetch distinct active projects ────────────────────────────────────────
  const { data: projectRows, error: projErr } = await db
    .from('issues')
    .select('project')
    .not('project', 'is', null)
    .in('status', ['refined', 'open'])
    .limit(2000)

  if (projErr) {
    return NextResponse.json({ error: projErr.message }, { status: 500 })
  }

  const projectSet: Record<string, boolean> = {}
  ;(projectRows ?? []).forEach(r => { if (r.project) projectSet[r.project as string] = true })
  const projects = Object.keys(projectSet)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const promoted: string[] = []
  const skipped: Record<string, number> = {}

  for (const project of projects) {
    for (const issueType of TYPES) {
      // ── Count current open issues of this type in this project ─────────────
      // Exclude issues assigned to michael/main — those are human-owned and
      // should not count toward the minimum (nor be promoted from refined).
      const { count: openCount, error: countErr } = await db
        .from('issues')
        .select('id', { count: 'exact', head: true })
        .eq('project', project)
        .eq('type', issueType)
        .eq('status', 'open')
        .not('assignee', 'in', '(michael,main)')

      if (countErr) {
        console.warn(`[queue-refill] count error ${project}/${issueType}:`, countErr.message)
        continue
      }

      const needed = QUEUE_MIN - (openCount ?? 0)
      if (needed <= 0) {
        skipped[`${project}/${issueType}`] = openCount ?? 0
        continue
      }

      // ── Fetch refined candidates ────────────────────────────────────────────
      // Never promote issues assigned to michael/main — those are human-owned.
      const { data: candidates, error: candErr } = await db
        .from('issues')
        .select('id,task_key,type,priority,due_date,created_at,parent_id,assignee,owner')
        .eq('project', project)
        .eq('type', issueType)
        .eq('status', 'refined')
        .is('started_at', null)          // skip issues PO is actively refining
        .not('assignee', 'in', '(michael,main)')
        .limit(50)

      if (candErr || !candidates?.length) continue

      // ── Fetch parent statuses for issues with parent_id ─────────────────────
      const parentIdSet: Record<string, boolean> = {}
      candidates.forEach(c => { if (c.parent_id) parentIdSet[c.parent_id] = true })
      const parentIds = Object.keys(parentIdSet)
      const underwayParents = new Set<string>()

      if (parentIds.length > 0) {
        const { data: parents } = await db
          .from('issues')
          .select('id,status')
          .in('id', parentIds)
          .eq('status', 'underway')
        ;(parents ?? []).forEach(p => underwayParents.add(p.id))
      }

      // ── Sort: parent=underway first, then priority, due_date, created_at ──
      const sorted = (candidates as RefinedIssue[]).sort((a, b) => {
        const aUnder = a.parent_id && underwayParents.has(a.parent_id) ? 0 : 1
        const bUnder = b.parent_id && underwayParents.has(b.parent_id) ? 0 : 1
        if (aUnder !== bUnder) return aUnder - bUnder

        const aPri = PRIORITY_WEIGHT[a.priority] ?? 5
        const bPri = PRIORITY_WEIGHT[b.priority] ?? 5
        if (aPri !== bPri) return aPri - bPri

        // due_date: nulls last
        if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1
        if (a.due_date) return -1
        if (b.due_date) return 1

        return a.created_at < b.created_at ? -1 : 1
      })

      const toPromote = sorted.slice(0, needed)

      // ── Promote each via MC API (fires post_functions: set_active_sprint, set_assignee) ──
      for (const issue of toPromote) {
        try {
          const res = await fetch(`${appUrl}/api/issues`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              task_key: issue.task_key,
              status: 'open',
              transitioned_by: 'cron-queue-refill',
            }),
          })
          if (res.ok) {
            promoted.push(issue.task_key)
            console.log(`[queue-refill] promoted ${issue.task_key} (${project}/${issueType}) → open`)
          } else {
            const err = await res.json() as { error?: string }
            console.warn(`[queue-refill] failed to promote ${issue.task_key}:`, err.error)
          }
        } catch (e) {
          console.warn(`[queue-refill] fetch error for ${issue.task_key}:`, e)
        }
      }
    }
  }

  // ── Queue empty alert ─────────────────────────────────────────────────────
  // If no open issues remain after refill, there's nothing for agents to work on.
  const { count: totalOpen } = await db
    .from('issues')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .not('assignee', 'in', '(michael,main)')

  if ((totalOpen ?? 0) === 0 && promoted.length === 0) {
    try {
      await fetch(`${appUrl}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '⚠️ **Queue empty** — no open issues across any project. All work is claimed or complete. Assign more work.',
          channels: ['discord-alerts'],
        }),
      })
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    promoted,
    promotedCount: promoted.length,
    skipped,
  })
}
