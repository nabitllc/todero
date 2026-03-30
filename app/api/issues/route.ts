import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec as execAsync } from 'child_process'

// ── Agent activation map ─────────────────────────────────────────────────────
const ASSIGNEE_AGENT_MAP: Record<string, string | null> = {
  'tester': 'tester',
  'scout': 'scout',
  'ops': 'ops',
  'kemuni-sme': 'kemuni-sme',
  'vespera-sme': 'vespera-sme',
  'main': 'main',
  'KAOS': 'main',
  'builder': 'main',
  'michael': null,
}

function activateAgentAsync(assignee: string, taskKey: string, title: string, status: string) {
  const agentId = ASSIGNEE_AGENT_MAP[assignee]
  if (!agentId) return
  const msg = status === 'in_review'
    ? `Issue ${taskKey} needs review: ${title}. Pick it up and review against AC + DoD.`
    : `Issue ${taskKey} is ready: ${title}. Pick it up and start work.`
  const cmd = `openclaw agent --agent ${agentId} --message ${JSON.stringify(msg)} 2>/dev/null`
  execAsync(cmd, { timeout: 30000 }, () => {})
}

// ── Discord helpers ───────────────────────────────────────────────────────────
const COMPLETED_TASKS_CHANNEL = '1487584901678104698'
const DISCORD_BOT_TOKEN = 'MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo'

const PROJECT_EMOJI: Record<string, string> = {
  Vespera: '🖤', Kemuni: '🚀', 'Mission Control': '🧠', Infrastructure: '⚙️'
}

function postDiscord(channelId: string, content: string) {
  const token = process.env.DISCORD_BOT_TOKEN ?? DISCORD_BOT_TOKEN
  fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://openclaw.ai, 1.0)'
    },
    body: JSON.stringify({ content })
  }).catch(err => console.error('[discord]', err))
}

const STATUS_EMOJI: Record<string, string> = {
  approved: '🚢', completed: '✅', closed: '✅', released: '🚀'
}
const TYPE_EMOJI: Record<string, string> = {
  task: '📋', bug: '🐛', feature: '✨', epic: '🏔️', ops: '⚙️', research: '🔍'
}

const RESOLUTION_LABELS: Record<string, string> = {
  code_change: 'Code Change',
  config_change: 'Config Change',
  no_action: 'No Action',
  duplicate: 'Duplicate',
  by_design: 'By Design',
  wont_fix: "Won't Fix",
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  not_reproducible: 'Not Reproducible',
  deferred: 'Deferred',
  completed: 'Completed',
}

function notifyDiscord(issue: { task_key?: string; title?: string; project?: string; resolution_type?: string; assignee?: string; severity?: string; status?: string; type?: string }) {
  const key = issue.task_key ?? '?'
  const status = issue.status ?? 'completed'
  const statusEmoji = STATUS_EMOJI[status] ?? '✅'
  const typeEmoji = TYPE_EMOJI[issue.type ?? 'task'] ?? '📋'
  const rawResType = issue.resolution_type ?? status
  const resType = RESOLUTION_LABELS[rawResType] ?? rawResType
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true
  }) + ' EST'
  const msg = `${statusEmoji} ${resType} | ${typeEmoji} **${key}** — ${issue.title ?? ''} at ${ts}`
  postDiscord(COMPLETED_TASKS_CHANNEL, msg)
}

function notifyCompletedTask(issue: Record<string, unknown>, toStatus: string) {
  const key = issue.task_key ?? '?'
  const statusEmoji = STATUS_EMOJI[toStatus] ?? '✅'
  const typeEmoji = TYPE_EMOJI[(issue.type as string) ?? 'task'] ?? '📋'
  const rawResType = (issue.resolution_type as string) ?? toStatus
  const resType = RESOLUTION_LABELS[rawResType] ?? rawResType
  const ts = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true
  }) + ' EST'
  const msg = `${statusEmoji} ${resType} | ${typeEmoji} **${key}** — ${issue.title ?? ''} at ${ts}`
  postDiscord(COMPLETED_TASKS_CHANNEL, msg)
}

function notifyPRReview(issue: { task_key?: string; title?: string; project?: string; feature_branch?: string; pr_url?: string }) {
  const key = issue.task_key ?? '?'
  const msg = `🔀 **PR Ready for Review**\n**[${key}]** ${issue.title ?? ''}\nProject: ${issue.project ?? ''} · Branch: ${issue.feature_branch ?? ''}\nPR: ${issue.pr_url ?? ''}\n<@409194957098713088> ready to merge`
  postDiscord('1487826368170299592', msg)
}

function notifyEscalation(issue: { task_key?: string; title?: string; project?: string; acceptance_criteria?: string; description?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const ac = (issue.acceptance_criteria ?? '').slice(0, 300)
  const desc = (issue.description ?? '').slice(0, 300)
  const msg = `🚨🚨 **ESCALATION: [${key}]** ${issue.title ?? ''}\n${emoji} Project: ${issue.project ?? ''}\n⚠️ **3 failed reviews — escalated to KAOS**\n📋 AC: ${ac}\n📝 Notes: ${desc}\n\n<@409194957098713088> manual investigation required.`
  postDiscord(COMPLETED_TASKS_CHANNEL, msg)
}

function notifyTestFailure(issue: { task_key?: string; title?: string; project?: string; description?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const desc = issue.description ?? ''
  const failureSection = desc.includes('---') ? desc.split('---').pop()?.trim().slice(0, 300) : desc.slice(0, 300)
  const msg = `🚨 **Test Failed: [${key}]** ${issue.title ?? ''}\n${emoji} Project: ${issue.project ?? ''}\n📝 Tester notes: ${failureSection || 'No details provided'}\n\nBuilder: pick up fix on next loop tick.`
  postDiscord(COMPLETED_TASKS_CHANNEL, msg)
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

// ── Task key generation ───────────────────────────────────────────────────────
const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC', Infrastructure: 'INF', Vespera: 'VES', Kemuni: 'KEM',
  Todero: 'TOD', todero: 'TOD'
}

async function generateTaskKey(project: string): Promise<{ task_key: string; task_number: number }> {
  const prefix = PROJECT_PREFIX[project] ?? 'TOD'
  try {
    const { data: seqNum, error: rpcErr } = await supabase.rpc('next_task_number')
    if (!rpcErr && typeof seqNum === 'number') {
      return { task_key: `${prefix}-${seqNum}`, task_number: seqNum }
    }
  } catch { /* RPC not yet deployed */ }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRow } = await supabase
      .from('issues')
      .select('task_number')
      .not('task_number', 'is', null)
      .order('task_number', { ascending: false })
      .limit(1)
      .single()
    const nextNumber = (maxRow?.task_number ?? 0) + 1 + attempt
    const key = `${prefix}-${nextNumber}`
    const { data: existing } = await supabase
      .from('issues')
      .select('id')
      .eq('task_key', key)
      .maybeSingle()
    if (!existing) return { task_key: key, task_number: nextNumber }
  }

  const ts = Date.now() % 1000000
  return { task_key: `${prefix}-${ts}`, task_number: ts }
}

// ── Workflow types ────────────────────────────────────────────────────────────
interface WorkflowTransition {
  condition_role: string | null
  validators: string[] | null
  post_functions: Array<{ action: string; params: Record<string, unknown> }> | null
}

interface TransitionError {
  error: string
  field?: string
}

// ── validateWorkflowTransition ────────────────────────────────────────────────
// Validates a status transition against the workflow_transitions table.
// Supports all issue types: task, bug, feature, epic, ops, research.
// Returns null on success, or a TransitionError on failure.
async function validateWorkflowTransition(
  issue: Record<string, unknown>,
  newStatus: string,
  transitionedBy: string | undefined,
  body: Record<string, unknown>
): Promise<{ transition: WorkflowTransition; error: null } | { transition: null; error: TransitionError }> {
  const issueType = (issue.type as string) ?? 'task'
  const fromStatus = issue.status as string

  // Supported types with full workflow engine
  const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
  if (!WORKFLOW_TYPES.includes(issueType)) {
    return { transition: null, error: null } as unknown as { transition: WorkflowTransition; error: null }
  }

  // Look up allowed transition
  const { data: transition, error: dbErr } = await supabase
    .from('workflow_transitions')
    .select('condition_role, validators, post_functions')
    .eq('issue_type', issueType)
    .eq('from_status', fromStatus)
    .eq('to_status', newStatus)
    .maybeSingle()

  if (dbErr) {
    console.error('[workflow] DB error looking up transition:', dbErr)
    // Don't block on DB error — fall through
    return { transition: null, error: null } as unknown as { transition: WorkflowTransition; error: null }
  }

  if (!transition) {
    return {
      transition: null,
      error: {
        error: `Invalid transition for ${issueType}: ${fromStatus} → ${newStatus}. Check allowed transitions.`,
        field: 'status'
      }
    }
  }

  // ── Condition role check ──
  const merged = { ...issue, ...body }
  const conditionRole = transition.condition_role

  if (conditionRole === 'po_or_main') {
    if (!transitionedBy || !['po', 'main'].includes(transitionedBy)) {
      return {
        transition: null,
        error: { error: 'Only po or main can execute this transition', field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'po_main_sme') {
    const allowed = ['po', 'main', 'kemuni-sme', 'vespera-sme']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return {
        transition: null,
        error: { error: 'Only po, main, or an SME (kemuni-sme, vespera-sme) can execute this transition', field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'po_main_ops') {
    const allowed = ['po', 'main', 'ops']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return {
        transition: null,
        error: { error: 'Only po, main, or ops can execute this transition', field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'assignee') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || transitionedBy !== issueAssignee) {
      return {
        transition: null,
        error: { error: `Only the assignee (${issueAssignee ?? 'unset'}) can execute this transition`, field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'assignee_or_ops') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || (transitionedBy !== issueAssignee && transitionedBy !== 'ops')) {
      return {
        transition: null,
        error: { error: `Only the assignee (${issueAssignee ?? 'unset'}) or ops can execute this transition`, field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'scout_only') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || (transitionedBy !== 'scout' && issueAssignee !== 'scout')) {
      return {
        transition: null,
        error: { error: 'Only scout can execute this transition', field: 'transitioned_by' }
      }
    }
  } else if (conditionRole === 'reviewer') {
    const issueReviewer = (body.reviewer as string) ?? (issue.reviewer as string)
    if (!transitionedBy || transitionedBy !== issueReviewer) {
      return {
        transition: null,
        error: { error: `Only the reviewer (${issueReviewer ?? 'unset'}) can execute this transition`, field: 'transitioned_by' }
      }
    }
  }

  // ── Validator checks ──
  const validators: string[] = transition.validators ?? []
  const missing: string[] = []

  for (const v of validators) {
    if (v === 'ref_required') {
      // At least one of: commit_sha, feature_branch, pr_url
      const hasRef = merged.feature_branch || merged.commit_sha || merged.pr_url
      if (!hasRef) {
        missing.push('commit_sha or feature_branch or pr_url (at least one required)')
      }
    } else if (v === 'test_status_passed') {
      if (merged.test_status !== 'passed') {
        missing.push('test_status=passed')
      }
    } else if (v === 'children_exist') {
      // Special: check if any child issues exist for this epic
      const issueId = issue.id as string
      if (issueId) {
        const { count } = await supabase
          .from('issues')
          .select('id', { count: 'exact', head: true })
          .eq('parent_id', issueId)
        if (!count || count === 0) {
          missing.push('children_exist (epic must have at least one child issue before activating)')
        }
      }
    } else {
      // Standard field presence check
      const val = merged[v]
      if (val === undefined || val === null || val === '') {
        missing.push(v)
      }
    }
  }

  if (missing.length > 0) {
    return {
      transition: null,
      error: {
        error: `Cannot move to ${newStatus}: missing required fields: ${missing.join(', ')}`,
        field: missing[0]
      }
    }
  }

  return { transition: transition as WorkflowTransition, error: null }
}

// ── executePostFunctions ──────────────────────────────────────────────────────
// Applies post-transition side effects: assignee changes, Discord notifications,
// rejection tracking, timestamp writes.
async function executePostFunctions(
  issue: Record<string, unknown>,
  toStatus: string,
  updatedIssue: Record<string, unknown>,
  postFunctions: Array<{ action: string; params: Record<string, unknown> }>,
  fields: Record<string, unknown>
): Promise<void> {
  for (const fn of postFunctions) {
    const { action, params } = fn

    if (action === 'set_assignee') {
      // Support both legacy `from_field` and new `source` param styles
      const sourceKey = (params.source ?? params.from_field) as string | null | undefined
      if (sourceKey === null || ('source' in params && params.source === null) || ('to' in params && params.to === null)) {
        // Unassign
        fields.assignee = null
      } else if (sourceKey) {
        // sourceKey is a field name — read from updated issue or original
        const newAssignee = (updatedIssue[sourceKey] ?? issue[sourceKey]) as string | null
        if (newAssignee !== undefined) {
          fields.assignee = newAssignee
        }
      }
    }

    if (action === 'notify_kaos') {
      // Send a message to the main KAOS agent via openclaw
      const notifyIssue = { ...issue, ...updatedIssue, ...(fields as Record<string, unknown>), status: toStatus } as Record<string, unknown>
      const key = (notifyIssue.task_key ?? '?') as string
      const title = (notifyIssue.title ?? '') as string
      // Fire-and-forget via openclaw message
      fetch('http://localhost:3001/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'agent:main',
          message: `🔬 Research completed: [${key}] ${title} — review findings and close or follow up.`
        })
      }).catch((e: Error) => console.warn('[notify_kaos] failed:', e.message))
    }

    if (action === 'notify_discord') {
      const channelId = (params.channel as string) ?? COMPLETED_TASKS_CHANNEL
      // Build a notification for the completed/approved transition
      const notifyIssue = { ...issue, ...updatedIssue, ...(fields as Record<string, unknown>), status: toStatus } as Record<string, unknown>
      const key = (notifyIssue.task_key ?? '?') as string
      const ts = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: true
      }) + ' EST'
      const statusEmoji = STATUS_EMOJI[toStatus] ?? '✅'
      const typeEmoji = TYPE_EMOJI[(notifyIssue.type as string) ?? 'task'] ?? '📋'
      const resType = (notifyIssue.resolution_type as string) ?? toStatus
      const msg = `${statusEmoji} ${resType} | ${typeEmoji} **${key}** — ${notifyIssue.title ?? ''} at ${ts}`
      postDiscord(channelId, msg)
    }

    if (action === 'increment_rejection') {
      fields.rejection_count = ((issue.rejection_count as number) ?? 0) + 1
      fields.last_rejected_at = new Date().toISOString()
    }

    if (action === 'copy_field') {
      const fromField = params.from as string
      const toField = params.to as string
      const value = (fields[fromField] ?? updatedIssue[fromField] ?? issue[fromField])
      if (value !== undefined) {
        fields[toField] = value
      }
    }

    if (action === 'set_timestamp') {
      const tsField = params.field as string
      fields[tsField] = new Date().toISOString()
    }
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET() {
  const { data, error } = await supabase
    .from('issues')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, description, status, assignee, project, priority, type, due_date,
          acceptance_criteria, sprint, parent_id, severity, resolution_type,
          feature_branch, pr_url, task_key: _clientKey, task_number: _clientNum, owner } = body

  // ── Required fields ──
  const missing: string[] = []
  if (!title?.trim())                missing.push('title')
  if (!project?.trim())              missing.push('project')
  if (!acceptance_criteria?.trim())  missing.push('acceptance_criteria')

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Cannot create issue — missing required fields: ${missing.join(', ')}. Every issue must have acceptance criteria before work begins.` },
      { status: 422 }
    )
  }

  // ── DoF: features require description ──
  if (type === 'feature' && !description?.trim()) {
    return NextResponse.json({ error: 'Feature requires: description' }, { status: 422 })
  }

  // ── Auto-set owner ──
  let effectiveOwner = owner
  if (!effectiveOwner) {
    const issueType = type ?? 'task'
    if (issueType === 'task' || issueType === 'bug') effectiveOwner = 'builder'
    else if (issueType === 'feature') {
      if (project === 'Kemuni') effectiveOwner = 'kemuni-sme'
      else if (project === 'Vespera') effectiveOwner = 'vespera-sme'
      else effectiveOwner = 'main'
    } else if (issueType === 'epic') effectiveOwner = 'main'
    else if (issueType === 'ops') effectiveOwner = 'ops'
    else if (issueType === 'research') effectiveOwner = 'scout'
    else effectiveOwner = 'builder'
  }

  // ── Sprint required for non-backlog issues ──
  const effectiveStatus = status ?? 'open'
  if (effectiveStatus !== 'backlog' && !sprint?.trim()) {
    return NextResponse.json(
      { error: 'sprint is required for non-backlog issues. Assign a sprint date (YYYY-MM-DD) or set status to backlog.' },
      { status: 422 }
    )
  }

  // ── Auto-routing ──
  let effectiveAssignee = assignee
  let routingNote = ''
  if (!effectiveAssignee || effectiveAssignee === 'main' || effectiveAssignee === 'kaos') {
    const effectiveType = type ?? 'task'
    const titleLower = (title ?? '').toLowerCase()
    const descLower = (description ?? '').toLowerCase()
    if (titleLower.includes('manual') || titleLower.includes('blocked') || descLower.includes('requires michael')) {
      effectiveAssignee = 'michael'; routingNote = '[auto-routed to michael: manual/blocked/requires michael]'
    } else if (titleLower.includes('research') || titleLower.includes('evaluate') || titleLower.includes('scout')) {
      effectiveAssignee = 'scout'; routingNote = '[auto-routed to scout: research/evaluate/scout keyword]'
    } else if (effectiveType === 'ops') {
      effectiveAssignee = 'ops'; routingNote = '[auto-routed to ops: type=ops]'
    } else if (effectiveType === 'task' || effectiveType === 'bug') {
      effectiveAssignee = 'builder'; routingNote = `[auto-routed to builder: type=${effectiveType}]`
    } else if (effectiveType === 'feature' || effectiveType === 'epic') {
      if (project === 'Kemuni') { effectiveAssignee = 'kemuni-sme'; routingNote = '[auto-routed to kemuni-sme: feature/epic + Kemuni]' }
      else if (project === 'Vespera') { effectiveAssignee = 'vespera-sme'; routingNote = '[auto-routed to vespera-sme: feature/epic + Vespera]' }
      else { effectiveAssignee = 'builder'; routingNote = `[auto-routed to builder: feature/epic + ${project}]` }
    } else {
      effectiveAssignee = 'builder'; routingNote = '[auto-routed to builder: default fallback]'
    }
  }

  const effectiveDescription = routingNote
    ? (description ? `${description}\n\n${routingNote}` : routingNote)
    : description

  // ── Dedup guard: reject duplicate tester/reviewer issues ──
  const isTesterIssue = (title ?? '').startsWith('🧪 Tester:') || (title ?? '').includes('Tester: Review')
  if (isTesterIssue || type === 'review') {
    const { data: existingByTitle } = await supabase
      .from('issues')
      .select('id, task_key, status')
      .eq('title', title)
      .not('status', 'in', '("done","cancelled")')
      .maybeSingle()
    if (existingByTitle) {
      return NextResponse.json(
        { error: `Duplicate review issue blocked: "${title}" already exists as ${existingByTitle.task_key} (${existingByTitle.status}). Update the existing issue instead.` },
        { status: 409 }
      )
    }
    if (parent_id && type === 'review') {
      const { data: existingByParent } = await supabase
        .from('issues')
        .select('id, task_key, status')
        .eq('parent_id', parent_id)
        .eq('type', 'review')
        .not('status', 'in', '("done","cancelled")')
        .maybeSingle()
      if (existingByParent) {
        return NextResponse.json(
          { error: `Duplicate review issue blocked: parent ${parent_id} already has a review issue (${existingByParent.task_key}). Update the existing one instead.` },
          { status: 409 }
        )
      }
    }
  }

  const finalStatus = isTesterIssue || type === 'review'
    ? (effectiveStatus === 'open' ? 'backlog' : effectiveStatus)
    : effectiveStatus

  const generated = await generateTaskKey(project)

  const { data, error } = await supabase
    .from('issues')
    .insert({
      title, description: effectiveDescription, status: finalStatus,
      assignee: effectiveAssignee, project,
      priority: priority ?? 'medium', type: type ?? 'task', due_date,
      acceptance_criteria, sprint, parent_id,
      ...(severity ? { severity } : {}),
      resolution_type, feature_branch, pr_url,
      task_key: generated.task_key, task_number: generated.task_number,
      owner: effectiveOwner,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id: rawId, task_key, transitioned_by: _transitionedBy, ...fields } = body
  const transitionedBy = _transitionedBy as string | undefined

  // ── Resolve UUID ──
  let id = rawId
  if (!id && task_key) {
    const { data: lookup, error: lookupErr } = await supabase
      .from('issues')
      .select('id')
      .eq('task_key', task_key)
      .single()
    if (lookupErr || !lookup) {
      return NextResponse.json({ error: `No issue found for task_key=${task_key}` }, { status: 404 })
    }
    id = lookup.id
  }
  if (!id) return NextResponse.json({ error: 'id or task_key required' }, { status: 400 })

  // ── Fetch existing record ──
  const { data: before } = await supabase
    .from('issues')
    .select('*')
    .eq('id', id)
    .single()

  // ── Closed issues are read-only ──
  if (before?.status === 'closed') {
    return NextResponse.json(
      { error: 'Issue is closed and read-only.' },
      { status: 403 }
    )
  }

  // ── Status transition validation ──
  if (fields.status && before?.status && fields.status !== before.status) {
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    const fromStatus = before.status as string
    const toStatus = fields.status as string

    // ── Full workflow engine (task, bug, feature, epic, ops, research) ──
    const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
    if (WORKFLOW_TYPES.includes(issueType)) {
      const result = await validateWorkflowTransition(
        before as Record<string, unknown>,
        toStatus,
        transitionedBy,
        fields as Record<string, unknown>
      )

      if (result.error) {
        return NextResponse.json(result.error, { status: 400 })
      }

      // If transition was found + valid, run post functions later (after DB write)
      // (handled below after update)
    } else {
      // ── Legacy validation for unknown/future types ──
      if (fields.status === 'done') {
        return NextResponse.json({ error: "done is retired, use completed or closed" }, { status: 400 })
      }
    }
  }

  // ── Auto-set timestamps + worked_by ──
  if (fields.status) {
    const now = new Date().toISOString()

    if (fields.status === 'in_progress') {
      if (!before?.started_at && !fields.started_at) fields.started_at = now
      const effectiveAssignee = fields.assignee ?? before?.assignee
      if (effectiveAssignee && !fields.worked_by) fields.worked_by = effectiveAssignee
    }

    if (fields.status === 'in_review') fields.submitted_at = now

    if (fields.status === 'completed') {
      fields.completed_at = now
      const completingAssignee = fields.assignee ?? before?.assignee
      if (completingAssignee && !fields.reviewed_by) fields.reviewed_by = completingAssignee
    }

    // Rejection routing for legacy flow (non-task)
    if (fields.status === 'open' && !fields.assignee && before?.worked_by) {
      fields.assignee = before.worked_by
    }

    // Legacy rejection tracking for in_review → open (non-task types)
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    if (issueType !== 'task' && fields.status === 'open' && before?.status === 'in_review') {
      fields.rejection_count = (before?.rejection_count ?? 0) + 1
      fields.last_rejected_at = now
      if (fields.reviewer_notes) fields.last_rejection_reason = fields.reviewer_notes
    }
  }

  // ── Fail count ──
  const isNewFailure = fields.test_status === 'failed' && before?.test_status !== 'failed'
  if (isNewFailure) {
    fields.fail_count = (before?.fail_count ?? 0) + 1
    if (fields.fail_count >= 3) {
      fields.status = 'blocked'
      fields.assignee = 'main'
    }
  }

  // ── Owner immutability ──
  if (fields.owner !== undefined) {
    const currentStatus = before?.status ?? ''
    if (['open', 'in_progress', 'in_review', 'done', 'blocked', 'code_review', 'product_review', 'approved', 'released'].includes(currentStatus)) {
      delete fields.owner
    }
  }

  // ── DB update ──
  let { data, error } = await supabase
    .from('issues')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  // Graceful fallback for missing columns
  if (error?.code === '42703') {
    const safeFields = { ...fields }
    for (const col of ['commit_sha', 'implementation_notes', 'reviewer_notes', 'fail_count',
                        'started_at', 'submitted_at', 'completed_at', 'worked_by', 'regression_test',
                        'rejection_count', 'last_rejected_at', 'last_rejection_reason',
                        'reviewer', 'reviewed_by', 'owner', 'deployer', 'auditor', 'transitioned_by']) {
      delete safeFields[col]
    }
    const retry = await supabase
      .from('issues')
      .update({ ...safeFields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Post functions (workflow engine for all supported types) ──
  if (fields.status && before?.status && fields.status !== before.status) {
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    const toStatus = fields.status as string
    const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']

    if (WORKFLOW_TYPES.includes(issueType) && data) {
      // Fetch the transition's post functions
      const { data: transition } = await supabase
        .from('workflow_transitions')
        .select('post_functions')
        .eq('issue_type', issueType)
        .eq('from_status', before.status)
        .eq('to_status', toStatus)
        .maybeSingle()

      if (transition?.post_functions && Array.isArray(transition.post_functions)) {
        const postFields: Record<string, unknown> = {}
        await executePostFunctions(
          before as Record<string, unknown>,
          toStatus,
          data as Record<string, unknown>,
          transition.post_functions as Array<{ action: string; params: Record<string, unknown> }>,
          postFields
        )

        // Apply post-function field changes if any
        if (Object.keys(postFields).length > 0) {
          const { data: postData } = await supabase
            .from('issues')
            .update({ ...postFields, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()
          if (postData) data = postData
        }
      }
    }
  }

  // ── Legacy Discord notifications (non-workflow types only) ──
  const resolvedType = fields.resolution_type ?? data?.resolution_type
  const issueType = (fields.type ?? before?.type ?? 'task') as string
  const WORKFLOW_TYPES_NOTIFY = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
  // Only fire legacy notify for types not yet on the workflow engine
  if (!WORKFLOW_TYPES_NOTIFY.includes(issueType) && (fields.status === 'approved' || fields.status === 'completed' || fields.status === 'closed') && data) {
    notifyDiscord({ ...data, resolution_type: resolvedType, status: fields.status })
  }

  // ── Activate next agent on transition ──
  if (fields.status && data) {
    const newAssignee = data.assignee ?? fields.assignee
    if (newAssignee && (fields.status === 'open' || fields.status === 'in_review')) {
      activateAgentAsync(newAssignee, data.task_key ?? '?', data.title ?? '', fields.status)
    }
  }

  // ── PR review notification when pr_url is first set ──
  if (fields.pr_url && !before?.pr_url && data) {
    notifyPRReview(data)
  }

  // ── Test failure notifications ──
  if (isNewFailure && data) {
    notifyTestFailure(data)
    if ((data.fail_count ?? 0) >= 3) notifyEscalation(data)
  }

  // ── UX gate — completed UX review child → complete parent ──
  if (fields.status === 'completed' && before?.assignee === 'ux' && before?.parent_id) {
    const { data: parentData } = await supabase
      .from('issues')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', before.parent_id)
      .select()
      .single()
    if (parentData) notifyDiscord({ ...parentData, resolution_type: parentData.resolution_type ?? 'code_change' })
  }

  // ── UX gate — failed UX review → create fix task ──
  if (isNewFailure && before?.assignee === 'ux' && before?.parent_id && data) {
    const uxNotes = (data.description ?? '').slice(0, 300)
    await supabase.from('issues').insert({
      title: `UX Fix: ${before.title ?? data.title}`,
      description: `UX review failed. Fix the following:\n\n${uxNotes}`,
      project: 'Mission Control',
      type: 'task', priority: 'high', assignee: 'builder',
      acceptance_criteria: 'Address all UX review feedback.',
      sprint: new Date().toISOString().split('T')[0],
      parent_id: before.parent_id, severity: 'S2'
    })
  }

  // ── Epic auto-completion ──
  if (fields.status === 'done' && data?.parent_id) {
    const { data: parentIssue } = await supabase
      .from('issues')
      .select('id, type, status, task_key, title, project')
      .eq('id', data.parent_id)
      .single()
    if (parentIssue?.type === 'epic' && parentIssue.status !== 'completed') {
      const { data: children } = await supabase
        .from('issues')
        .select('id, status')
        .eq('parent_id', data.parent_id)
      const allDone = children && children.length > 0 && children.every(c => c.status === 'completed' || c.status === 'done')
      if (allDone) {
        await supabase
          .from('issues')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', data.parent_id)
      }
    }
  }

  return NextResponse.json(data)
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('issues').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
