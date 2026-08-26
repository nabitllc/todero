import { NextResponse } from 'next/server'
import { assertDbConfigured, db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

function getSupabase() {
  // db() throws a DbConfigurationError naming the exact missing variables.
  assertDbConfigured()
  return db()
}

// no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were members of
// this set. Neither agent exists. An id listed here is classified 'agent'
// rather than 'system', so their presence made the feed able to attribute an
// event to a fabricated agent as though it were a real one.
const AGENT_ACTORS = new Set(['builder','tester','designer','ops','scout','main','KAOS','auditor','deployer','po'])
const HUMAN_ACTORS = new Set(['michael'])

function actorType(assignee: string): 'agent' | 'human' | 'system' {
  if (!assignee) return 'system'
  if (AGENT_ACTORS.has(assignee)) return 'agent'
  if (HUMAN_ACTORS.has(assignee)) return 'human'
  return 'system'
}

// no-invented-projects-sweep: 'kemuni-sme': 'Kemuni SME' and
// 'vespera-sme': 'Vespera SME' were entries here. This map is what turned a
// fabricated id into a polished display name in the activity feed; without it
// an unknown actor falls through to the raw id, which is the honest rendering.
const ACTOR_NAMES: Record<string, string> = {
  builder: 'Builder', tester: 'Tester', designer: 'Designer', ops: 'Ingo',
  scout: 'Scout',
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
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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

  // This route reaches the raw db proxy, not GET /api/issues (which already
  // hides archived rows by default). Without this filter an archived issue
  // — e.g. "TOD-1 CRITIC probe epic" — shows up in Recent Activity as if it
  // were live. Excluded at the query, not filtered out of the response,
  // per the no-invented-projects piece.
  const includeArchived =
    (searchParams.get('include_archived') ?? '').toLowerCase() === '1' ||
    (searchParams.get('include_archived') ?? '').toLowerCase() === 'true'
  if (!includeArchived) query = query.is('archived_at', null)

  // ActivityFeed.tsx has always SENT `project` on this request. This route
  // selected the column and never filtered on it, so the landing screen's
  // Recent Activity showed every project's rows while the request said it was
  // scoped. A parameter that is accepted and ignored is worse than one that is
  // missing: the caller can see it in the URL and reasonably concludes the
  // filter is applied. Nothing surfaced it because the other projects happened
  // to be archived — which is exactly the condition this wave stopped relying on.
  // The header, not the query param. Reading searchParams meant scope was a
  // CLIENT PROP again — this route was clean only because ActivityFeed.tsx
  // happens to pass one, and that prop is optional. Drop the prop and the route
  // handed over every project. That is the exact sentence this wave exists to
  // falsify, left standing on the route the piece named first.
  const resolvedScope = req.headers.get('x-mc-project')
  // TOD-2480. Not `x-mc-all-projects`. middleware stamps that for EVERY
  // cross-project destination, so it only ever meant "the referer is a fleet or
  // runs page" — and this route read it as "may see every project", exactly as
  // /api/issues did. That is the fixed-in-one-file-live-one-file-over pattern
  // this program keeps paying for, and it was live here while the sibling was
  // being fixed. The hint names the ONE project the destination claims to be.
  const crossProjectHint = req.headers.get('x-mc-cross-project-hint')
  const projectParam = searchParams.get('project')
  const wantsAllProjects = ['1', 'true', 'yes'].includes(
    (searchParams.get('all_projects') ?? '').toLowerCase()
  )
  // A cross-project destination may name exactly one project: its own.
  if (crossProjectHint && projectParam && projectParam !== crossProjectHint) {
    return NextResponse.json(
      {
        error: 'project_outside_scope',
        message: `This screen is scoped to "${crossProjectHint}"; it cannot request "${projectParam}".`,
      },
      { status: 400 },
    )
  }
  const effectiveScope = resolvedScope || projectParam || null
  if (effectiveScope) {
    query = query.eq('project', effectiveScope)
  } else if (!wantsAllProjects) {
    return NextResponse.json(
      {
        error: 'unscoped_issues_read',
        message:
          'This activity query has no project scope. Request it from a /p/<project> screen, ' +
          'or pass all_projects=1 to read across every project deliberately.',
      },
      { status: 400 },
    )
  }

  if (actor) query = query.eq('assignee', actor)
  if (issueId) query = query.eq('id', issueId)
  if (statusFilter) query = query.in('status', statusFilter)

  const { data, error } = await query

  if (error) {
    return dbQueryErrorResponse(error, 'issues')
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
