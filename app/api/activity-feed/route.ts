import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

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

function deriveEventType(status: string): string {
  if (status === 'open') return 'issue_opened'
  if (status === 'in_progress') return 'issue_started'
  if (status === 'code_review') return 'issue_in_review'
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
  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'), 0)
  const project = searchParams.get('project')
  const actor = searchParams.get('actor')
  const issueId = searchParams.get('issue_id')
  const eventTypeParam = searchParams.get('event_type')
  const eventTypeFilter = eventTypeParam
    ? eventTypeParam.split(',').map(s => s.trim()).filter(Boolean)
    : null

  let query = supabase
    .from('issues')
    .select('id,task_key,title,status,assignee,updated_at,resolution_type,project,type')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (project) query = query.eq('project', project)
  if (actor) query = query.eq('assignee', actor)
  if (issueId) query = query.eq('id', issueId)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  let events = (data ?? []).map((issue: any) => {
    const updatedMs = new Date(issue.updated_at).getTime()
    const agoMin = Math.round((now - updatedMs) / 60000)
    const aType = actorType(issue.assignee)
    const eventType = deriveEventType(issue.status)
    return {
      id: issue.id,
      icon: statusIcon(issue.status),
      actor: issue.assignee ?? null,
      actor_name: ACTOR_NAMES[issue.assignee] ?? issue.assignee ?? 'System',
      actor_type: aType,
      description: describeTransition(issue.title, issue.status, issue.resolution_type),
      issue_title: issue.title,
      task_key: issue.task_key,
      issue_id: issue.id,
      timestamp: issue.updated_at,
      ago_min: agoMin,
      event_type: eventType,
      project: issue.project,
    }
  })

  if (eventTypeFilter) {
    events = events.filter(e => eventTypeFilter.includes(e.event_type))
  }

  return NextResponse.json(events)
}
