import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  return createClient(url, key)
}

const AGENT_ACTORS = new Set(['builder','tester','designer','ops','scout','kemuni-sme','vespera-sme','main','KAOS','auditor','deployer','po'])
const HUMAN_ACTORS = new Set(['michael'])

function actorType(assignee: string): 'agent' | 'human' | 'system' {
  if (!assignee) return 'system'
  if (AGENT_ACTORS.has(assignee)) return 'agent'
  if (HUMAN_ACTORS.has(assignee)) return 'human'
  return 'system'
}

const ACTOR_NAMES: Record<string, string> = {
  builder: 'Builder', tester: 'Tester', designer: 'Designer', ops: 'Ops',
  scout: 'Scout', 'kemuni-sme': 'Kemuni SME', 'vespera-sme': 'Vespera SME',
  main: 'KAOS', KAOS: 'KAOS', michael: 'Michael', auditor: 'Auditor',
  deployer: 'Deployer', po: 'PO',
}

function statusIcon(status: string): string {
  const map: Record<string, string> = {
    open: '📋', in_progress: '⚙️', code_review: '👀', product_review: '🎯',
    approved: '✅', completed: '✅', released: '🚀', closed: '🔒',
    backlog: '📥', defined: '📝', blocked: '🚫', cancelled: '❌',
  }
  return map[status] ?? '📌'
}

// Maps event_type filter values to the corresponding issue statuses
const EVENT_TYPE_TO_STATUSES: Record<string, string[]> = {
  issue_opened:    ['open'],
  issue_started:   ['in_progress'],
  issue_in_review: ['code_review', 'product_review'],
  issue_completed: ['approved', 'completed'],
  issue_cancelled: ['cancelled'],
  issue_change:    ['released', 'closed', 'backlog', 'defined', 'blocked'],
}

function deriveEventType(status: string): string {
  if (status === 'open') return 'issue_opened'
  if (status === 'in_progress') return 'issue_started'
  if (status === 'code_review' || status === 'product_review') return 'issue_in_review'
  if (status === 'approved' || status === 'completed') return 'issue_completed'
  if (status === 'cancelled') return 'issue_cancelled'
  return 'issue_change'
}

function describeTransition(title: string, status: string, resolution_type?: string): string {
  const label = resolution_type && resolution_type !== 'none' ? ` (${resolution_type})` : ''
  const verb: Record<string, string> = {
    open: 'opened', in_progress: 'started', code_review: 'sent for review',
    product_review: 'sent for product review', approved: 'approved',
    completed: 'completed', released: 'released', closed: 'closed',
    backlog: 'moved to backlog', defined: 'defined', blocked: 'blocked',
    cancelled: 'cancelled',
  }
  return `${title} → ${verb[status] ?? status}${label}`
}

export async function GET(req: Request) {
  let supabase
  try {
    supabase = getSupabase()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'), 0)
  const actor = searchParams.get('actor')
  const issueId = searchParams.get('issue_id')
  const eventTypeParam = searchParams.get('event_type')

  // Translate event_type filter to status values for DB-level filtering
  let statusFilter: string[] | null = null
  if (eventTypeParam) {
    const eventTypes = eventTypeParam.split(',').map(s => s.trim()).filter(Boolean)
    const statuses = eventTypes.flatMap(et => EVENT_TYPE_TO_STATUSES[et] ?? [])
    statusFilter = statuses.length > 0 ? statuses : null
  }

  let query = supabase
    .from('issues')
    .select('id,task_key,title,status,assignee,created_at,updated_at,resolution_type,project,type')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actor) query = query.eq('assignee', actor)
  if (issueId) query = query.eq('id', issueId)
  if (statusFilter) query = query.in('status', statusFilter)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const events = (data ?? []).map((issue: any) => {
    const createdMs = new Date(issue.created_at).getTime()
    const agoMin = Math.round((now - createdMs) / 60000)
    return {
      id: issue.id,
      icon: statusIcon(issue.status),
      actor: issue.assignee ?? null,
      actor_name: ACTOR_NAMES[issue.assignee] ?? issue.assignee ?? 'System',
      actor_type: actorType(issue.assignee),
      description: describeTransition(issue.title, issue.status, issue.resolution_type),
      issue_title: issue.title,
      task_key: issue.task_key,
      issue_id: issue.id,
      timestamp: issue.created_at,
      ago_min: agoMin,
      event_type: deriveEventType(issue.status),
      project: issue.project,
    }
  })

  return NextResponse.json(events)
}
