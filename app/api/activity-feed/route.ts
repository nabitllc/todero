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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30'), 100)
  const project = searchParams.get('project')

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('issues')
    .select('id,task_key,title,status,assignee,updated_at,resolution_type,project,type')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (project) query = query.eq('project', project)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const events = (data ?? []).map((issue: any) => {
    const updatedMs = new Date(issue.updated_at).getTime()
    const agoMin = Math.round((now - updatedMs) / 60000)
    const aType = actorType(issue.assignee)
    return {
      id: issue.id,
      icon: statusIcon(issue.status),
      actor_name: ACTOR_NAMES[issue.assignee] ?? issue.assignee ?? 'System',
      actor_type: aType,
      description: describeTransition(issue.title, issue.status, issue.resolution_type),
      task_key: issue.task_key,
      issue_id: issue.id,
      timestamp: issue.updated_at,
      ago_min: agoMin,
      event_type: 'issue_change',
      project: issue.project,
    }
  })

  return NextResponse.json(events)
}
