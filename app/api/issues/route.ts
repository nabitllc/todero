import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec as execAsync } from 'child_process'
import { createAdminClient, getHubClient } from '@/lib/hub-client'
import {
  VALID_TYPES,
  VALID_PRIORITIES,
  VALID_SEVERITIES,
  VALID_STATUSES,
  VALID_RESOLUTION_TYPES,
  normalizeProjectName,
  getProjectPrefix,
} from '@/lib/constants'
import { withIssueStatusCategory, withIssueStatusCategoryList } from '@/lib/status-category'
import {
  isActiveWorkIssueStatus,
  isCompletedIssueStatus,
  isTerminalIssueStatus,
} from '@/lib/issue-lifecycle'
import {
  aggregateReviewerNotes,
  applyExecutionStatusRouting,
  computeDualReviewState,
  normalizeReviewStatus,
  resolveReopenAssignee,
} from '@/lib/issue-routing'
import { recordAgentFailure, resetAgentFailures } from '@/lib/loop-breaker'

// ── Agent activation map ─────────────────────────────────────────────────────
const ASSIGNEE_AGENT_MAP: Record<string, string | null> = {
  'tester': 'tester',
  'designer': 'designer',
  'ux': 'designer',
  'scout': 'scout',
  'ops': 'ops',
  'kemuni-sme': 'kemuni-sme',
  'vespera-sme': 'vespera-sme',
  'main': 'main',
  'KAOS': 'main',
  'builder': 'builder',
  'michael': null,
}

const CLAUDE_BIN = '/Users/kemuniagent/.local/bin/claude'
const WORKSPACE = '/Users/kemuniagent/todero/config'
const TODERO_DIR = '/Users/kemuniagent/todero'

function activateAgentAsync(assignee: string, taskKey: string, title: string, status: string, _issueId?: string) {
  const agentId = ASSIGNEE_AGENT_MAP[assignee]
  if (!agentId) return

  // Only activate for REVIEW statuses (code_review, product_review).
  if (status !== 'code_review' && status !== 'product_review') return

  // TOD-XXX (2026-04-10): previously spawned via exec() with the broken
  // `$(cat ...)` shell substitution — same root cause as the silent death
  // bug. Now delegates to /api/run-agent (which uses spawn() + worktree
  // isolation + log sentinels) via internal fetch. Fire-and-forget so the
  // PATCH response isn't blocked on the spawn.
  void (async () => {
    try {
      await fetch(`http://localhost:3000/api/run-agent?agent=${agentId}`, { method: 'POST' })
    } catch (err) {
      console.warn(`[activateAgentAsync] dispatch to ${agentId} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  // Unused params kept for backward-compat with existing callers
  void taskKey; void title
}

function activateCodeReviewAgents(taskKey: string, title: string) {
  activateAgentAsync('tester', taskKey, title, 'code_review')
  activateAgentAsync('designer', taskKey, title, 'code_review')
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-CHAIN — DO NOT REMOVE — PROTECTED BY .githooks/pre-commit
// Without this, the pipeline stalls for up to 30 min between every hand-off.
// With it, every PATCH immediately wakes the next lane.
// Has been reverted 3+ times by Builder agents on stale branches.
// ═══════════════════════════════════════════════════════════════════════════
const STATUS_PICKUP_LANES: Record<string, string[]> = {
  backlog:        ['po', 'todero-sme', 'kemuni-sme', 'vespera-sme', 'infra-sme'],
  defined:        ['po'],
  open:           ['builder', 'ops', 'scout'],
  code_review:    ['tester', 'designer'],
  product_review: [],
  approved:       ['deployer'],
  released:       ['auditor'],
}
function selfChainOnStatus(toStatus: string | undefined | null) {
  if (!toStatus) return
  const lanes = STATUS_PICKUP_LANES[toStatus]
  if (!lanes || lanes.length === 0) return
  for (const lane of lanes) {
    void (async () => {
      try {
        await fetch(`http://localhost:3000/api/run-agent?agent=${lane}`, { method: 'POST' })
      } catch (err) {
        console.warn(`[selfChain] ${lane} for ${toStatus}:`, err instanceof Error ? err.message : String(err))
      }
    })()
  }
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
      'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)'
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

// ── Activity event capture ────────────────────────────────────────────────────
const KNOWN_AGENT_IDS = new Set([
  'builder', 'tester', 'designer', 'ux', 'scout', 'ops',
  'kemuni-sme', 'vespera-sme', 'main', 'KAOS', 'auditor',
  'deployer', 'po', 'monitor-stale', 'heartbeat',
])

function resolveActorType(actor: string | null | undefined): 'agent' | 'human' {
  if (!actor) return 'human'
  return KNOWN_AGENT_IDS.has(actor) ? 'agent' : 'human'
}

function recordActivityEvent(
  issueId: string,
  issueKey: string | null | undefined,
  eventType: string,
  actor: string | null | undefined,
  metadata: Record<string, unknown>
) {
  void supabase.from('activity_events').insert({
    issue_id: issueId,
    issue_key: issueKey ?? null,
    event_type: eventType,
    actor: actor ?? null,
    actor_type: resolveActorType(actor),
    metadata,
  }).then(() => {}) // fire-and-forget
}

// ── Hierarchy validation ──────────────────────────────────────────────────────
async function validateHierarchy(
  type: string,
  parentId: string | null | undefined
): Promise<{ error: string } | null> {
  if (type === 'task' || type === 'bug') {
    if (!parentId) {
      return { error: `type=${type} requires parent_id pointing to a feature issue` }
    }
    const { data: parent, error: dbErr } = await supabase
      .from('issues')
      .select('id, type, task_key')
      .eq('id', parentId)
      .maybeSingle()
    if (dbErr || !parent) {
      return { error: `parent_id ${parentId} does not exist` }
    }
    if (parent.type !== 'feature') {
      return { error: `type=${type} requires parent to be a feature, but parent ${parent.task_key} is type=${parent.type}` }
    }
  } else if (type === 'feature') {
    // TOD-1203: parent_id is optional at creation; if provided, must point to an epic
    if (parentId) {
      const { data: parent, error: dbErr } = await supabase
        .from('issues')
        .select('id, type, task_key')
        .eq('id', parentId)
        .maybeSingle()
      if (dbErr || !parent) {
        return { error: `parent_id ${parentId} does not exist` }
      }
      if (parent.type !== 'epic') {
        return { error: `type=feature requires parent to be an epic, but parent ${parent.task_key} is type=${parent.type}` }
      }
    }
  } else if (type === 'epic') {
    if (parentId) {
      return { error: `type=epic should not have a parent_id (epics are top-level)` }
    }
  }
  return null
}

// ── Task key generation ───────────────────────────────────────────────────────

async function prepareIssueIdentity(project: string): Promise<Partial<{ task_key: string; task_number: number }>> {
  const prefix = getProjectPrefix(project)
  const { data: seqNum, error: rpcErr } = await supabase.rpc('next_task_number')

  if (!rpcErr && typeof seqNum === 'number') {
    return { task_key: `${prefix}-${seqNum}`, task_number: seqNum }
  }

  console.warn('[issues] next_task_number RPC unavailable; falling back to API-assigned identity', rpcErr)

  const { data: maxRow } = await supabase
    .from('issues')
    .select('task_number')
    .not('task_number', 'is', null)
    .order('task_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextNumber = ((maxRow as { task_number?: number } | null)?.task_number ?? 0) + 1
  return { task_key: `${prefix}-${nextNumber}`, task_number: nextNumber }
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
async function validateWorkflowTransition(
  issue: Record<string, unknown>,
  newStatus: string,
  transitionedBy: string | undefined,
  body: Record<string, unknown>
): Promise<{ transition: WorkflowTransition; error: null } | { transition: null; error: TransitionError }> {
  const issueType = (issue.type as string) ?? 'task'
  const fromStatus = issue.status as string

  const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
  if (!WORKFLOW_TYPES.includes(issueType)) {
    return { transition: null, error: null } as unknown as { transition: WorkflowTransition; error: null }
  }

  const { data: transition, error: dbErr } = await supabase
    .from('workflow_transitions')
    .select('condition_role, validators, post_functions')
    .eq('issue_type', issueType)
    .eq('from_status', fromStatus)
    .eq('to_status', newStatus)
    .maybeSingle()

  if (dbErr) {
    console.error('[workflow] DB error looking up transition:', dbErr)
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

  const merged = { ...issue, ...body }
  const conditionRole = transition.condition_role

  if (conditionRole === 'po_or_main') {
    if (!transitionedBy || !['po', 'main'].includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po or main can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'po_main_sme') {
    const allowed = ['po', 'main', 'kemuni-sme', 'vespera-sme']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po, main, or an SME can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'po_main_ops') {
    const allowed = ['po', 'main', 'ops']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po, main, or ops can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'assignee') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || transitionedBy !== issueAssignee) {
      return { transition: null, error: { error: `Only the assignee (${issueAssignee ?? 'unset'}) can execute this transition`, field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'assignee_or_ops') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || (transitionedBy !== issueAssignee && transitionedBy !== 'ops')) {
      return { transition: null, error: { error: `Only the assignee (${issueAssignee ?? 'unset'}) or ops can execute this transition`, field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'scout_only') {
    const issueAssignee = (issue.assignee as string) ?? (body.assignee as string)
    if (!transitionedBy || (transitionedBy !== 'scout' && issueAssignee !== 'scout')) {
      return { transition: null, error: { error: 'Only scout can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'reviewer') {
    const issueReviewer = (body.reviewer as string) ?? (issue.reviewer as string)
    if (!transitionedBy || transitionedBy !== issueReviewer) {
      return { transition: null, error: { error: `Only the reviewer (${issueReviewer ?? 'unset'}) can execute this transition`, field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'tester_or_designer') {
    if (!transitionedBy || !['tester', 'designer', 'ux'].includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only tester or designer can execute this transition', field: 'transitioned_by' } }
    }
  }

  const validators: string[] = transition.validators ?? []
  const missing: string[] = []

  for (const v of validators) {
    if (v === 'ref_required') {
      const isExemptType = issueType === 'ops' || issueType === 'research'
      if (!isExemptType) {
        const hasRef = merged.feature_branch || merged.commit_sha || merged.pr_url
        if (!hasRef) {
          missing.push('commit_sha or feature_branch or pr_url (at least one required)')
        }
      }
    } else if (v === 'test_status_passed') {
      if (merged.test_status !== 'passed') {
        missing.push('test_status=passed')
      }
    } else if (v === 'dual_review_passed') {
      const { bothPassed } = computeDualReviewState(merged)
      if (!bothPassed) {
        missing.push('tester_status=passed and designer_status=passed')
      }
    } else if (v === 'children_exist') {
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

  // 6.7 (TOD-1204): Auto-activate parent epic when feature moves to open
  if (issueType === 'feature' && newStatus === 'open' && issue.parent_id) {
    const { data: parentEpic } = await supabase
      .from('issues')
      .select('id, status, type, task_key')
      .eq('id', issue.parent_id as string)
      .single()
    if (parentEpic?.type === 'epic' && ['backlog', 'draft'].includes(parentEpic.status)) {
      const { error: activateErr } = await supabase
        .from('issues')
        .update({ status: 'active' })
        .eq('id', parentEpic.id)
      if (activateErr) {
        console.error(`[TOD-1204] failed to auto-activate parent epic ${parentEpic.task_key}:`, activateErr.message)
      } else {
        console.log(`[TOD-1204] auto-activated parent epic ${parentEpic.task_key} (was ${parentEpic.status}) because feature is moving to open`)
      }
    }
  }

  return { transition: transition as WorkflowTransition, error: null }
}

// ── executePostFunctions ──────────────────────────────────────────────────────
async function getActiveSprintForProject(project: string | null | undefined): Promise<{ name: string; start_date: string } | null> {
  if (!project) return null
  const { data, error } = await supabase
    .from('sprints')
    .select('name, start_date')
    .eq('project', project)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn('[set_active_sprint] failed to fetch active sprint:', error.message)
    return null
  }
  return data as { name: string; start_date: string } | null
}

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
      const sourceKey = (params.source ?? params.from_field) as string | null | undefined
      if (sourceKey === null || ('source' in params && params.source === null) || ('to' in params && params.to === null)) {
        fields.assignee = null
      } else if (sourceKey) {
        const newAssignee = (updatedIssue[sourceKey] ?? issue[sourceKey]) as string | null
        if (newAssignee !== undefined) {
          fields.assignee = newAssignee
        }
      }
    }

    if (action === 'notify_kaos') {
      const notifyIssue = { ...issue, ...updatedIssue, ...(fields as Record<string, unknown>), status: toStatus } as Record<string, unknown>
      const key = (notifyIssue.task_key ?? '?') as string
      const title = (notifyIssue.title ?? '') as string
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

    if (action === 'set_active_sprint') {
      const currentSprint = (fields.sprint ?? updatedIssue.sprint ?? issue.sprint) as string | null | undefined
      const project = (fields.project ?? updatedIssue.project ?? issue.project) as string | null | undefined
      if (!currentSprint && project) {
        const activeSprint = await getActiveSprintForProject(project)
        if (activeSprint) {
          fields.sprint = activeSprint.start_date
        }
      }
    }

    if (action === 'activate_code_review_agents') {
      const nextIssue = { ...issue, ...updatedIssue, ...fields }
      activateCodeReviewAgents((nextIssue.task_key ?? '?') as string, (nextIssue.title ?? '') as string)
    }

    if (action === 'activate_reviewer') {
      const nextIssue = { ...issue, ...updatedIssue, ...fields }
      const reviewer = (nextIssue.reviewer ?? nextIssue.assignee ?? 'po') as string
      activateAgentAsync(reviewer, (nextIssue.task_key ?? '?') as string, (nextIssue.title ?? '') as string, toStatus, (nextIssue.id ?? '') as string)
    }
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const taskKey = url.searchParams.get('task_key')

  if (taskKey) {
    // AGGREGATE QUERY — no hub scope for task_key lookups (keys are globally unique)
    const { data, error } = await createAdminClient()
      .from('issues')
      .select('*')
      .eq('task_key', taskKey)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: `No issue found for task_key=${taskKey}` }, { status: 404 })
    return NextResponse.json(withIssueStatusCategory(data))
  }

  const search = url.searchParams.get('search')
  const limit = parseInt(url.searchParams.get('limit') || '0', 10)
  const projectParam = url.searchParams.get('project')
  const businessIdParam = url.searchParams.get('business_id')
  const assigneeParam = url.searchParams.get('assignee')
  const statusParam = url.searchParams.get('status')

  // Hub-scoped query when business_id provided; fallback to admin for aggregate queries
  const db = businessIdParam ? getHubClient(businessIdParam) : null
  // AGGREGATE QUERY — no business_id filter; returns issues across all hubs
  const baseClient = db ? db.client : createAdminClient()
  let query = baseClient.from('issues').select('*')

  if (db) {
    query = query.eq('business_id', db.businessId)
  }

  // Direct project filter (can combine with business_id for narrowing)
  if (projectParam) {
    query = query.eq('project', projectParam)
  }

  if (assigneeParam) {
    query = query.eq('assignee', assigneeParam)
  }

  if (statusParam) {
    query = query.eq('status', statusParam)
  }

  if (search) {
    query = query.ilike('title', `%${search}%`)
    query = query.order('updated_at', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  if (limit > 0) {
    query = query.limit(limit)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(withIssueStatusCategoryList(data))
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, description, status, assignee, project, priority, type, due_date,
          acceptance_criteria, sprint, parent_id, severity, resolution_type,
          feature_branch, pr_url, task_key: _clientKey, task_number: _clientNum, owner } = body

  const normalizedProject = normalizeProjectName(project)

  const missing: string[] = []
  if (!title?.trim())                missing.push('title')
  if (!normalizedProject.trim())     missing.push('project')
  if (!acceptance_criteria?.trim())  missing.push('acceptance_criteria')

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Cannot create issue — missing required fields: ${missing.join(', ')}. Every issue must have acceptance criteria before work begins.` },
      { status: 422 }
    )
  }

  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `Invalid value for 'type': "${type}". Allowed values: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    )
  }
  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { error: `Invalid value for 'priority': "${priority}". Allowed values: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (severity && !VALID_SEVERITIES.includes(severity)) {
    return NextResponse.json(
      { error: `Invalid value for 'severity': "${severity}". Allowed values: ${VALID_SEVERITIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid value for 'status': "${status}". Allowed values: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }
  if (resolution_type && !VALID_RESOLUTION_TYPES.includes(resolution_type)) {
    return NextResponse.json(
      { error: `Invalid value for 'resolution_type': "${resolution_type}". Allowed values: ${VALID_RESOLUTION_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  if (type === 'feature' && !description?.trim()) {
    return NextResponse.json({ error: 'Feature requires: description' }, { status: 422 })
  }

  const hierarchyErr = await validateHierarchy(type ?? 'task', parent_id)
  if (hierarchyErr) {
    return NextResponse.json({ error: hierarchyErr.error }, { status: 400 })
  }

  let effectiveOwner = owner
  if (!effectiveOwner) {
    const issueType = type ?? 'task'
    if (issueType === 'task' || issueType === 'bug') effectiveOwner = 'builder'
    else if (issueType === 'feature') {
      if (normalizedProject === 'Kemuni') effectiveOwner = 'kemuni-sme'
      else if (normalizedProject === 'Vespera') effectiveOwner = 'vespera-sme'
      else effectiveOwner = 'main'
    } else if (issueType === 'epic') effectiveOwner = 'main'
    else if (issueType === 'ops') effectiveOwner = 'ops'
    else if (issueType === 'research') effectiveOwner = 'scout'
    else effectiveOwner = 'builder'
  }

  const effectiveStatus = status ?? 'open'

  // TOD-XXX (2026-04-10): sprint hygiene guard. If sprint is missing OR is a
  // past date (older than today's ET date), auto-correct to today. Closed
  // sprints on new issues are a common agent mistake (TOD-811 was created with
  // sprint=2026-04-01, the April 1st sprint, because PO didn't know the current
  // date). The Board default filter hides closed sprints, making such issues
  // invisible.
  const todayEt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()) // YYYY-MM-DD
  let effectiveSprint = sprint?.trim() || null
  let sprintAutoCorrected = false
  // Auto-correct: bad sprint date format, or past date → today's ET date
  if (effectiveSprint && /^\d{4}-\d{2}-\d{2}$/.test(effectiveSprint) && effectiveSprint < todayEt) {
    effectiveSprint = todayEt
    sprintAutoCorrected = true
  }
  // Fill: missing sprint on non-backlog → today
  if (!effectiveSprint && effectiveStatus !== 'backlog') {
    effectiveSprint = todayEt
    sprintAutoCorrected = true
  }

  let effectiveAssignee = assignee
  let routingNote = ''
  if (!effectiveAssignee) {
    const effectiveType = type ?? 'task'
    const projectStr = normalizedProject
    if (effectiveType === 'task' || effectiveType === 'bug') {
      effectiveAssignee = 'builder'; routingNote = `[auto-routed to builder: type=${effectiveType}]`
    } else if (effectiveType === 'ops') {
      effectiveAssignee = 'ops'; routingNote = '[auto-routed to ops: type=ops]'
    } else if (effectiveType === 'research') {
      effectiveAssignee = 'scout'; routingNote = '[auto-routed to scout: type=research]'
    } else if (effectiveType === 'feature') {
      // TOD-XXX (2026-04-10): features always land on PO first for grooming
      // (acceptance criteria, child task breakdown). PO transitions them to
      // 'defined' then to 'open' once they're ready for Builder.
      effectiveAssignee = 'po'; routingNote = `[auto-routed to po: type=feature + project=${projectStr}]`
    } else if (effectiveType === 'epic') {
      effectiveAssignee = 'main'; routingNote = '[auto-routed to main: type=epic]'
    } else {
      effectiveAssignee = 'builder'; routingNote = '[auto-routed to builder: default fallback]'
    }
  }

  // TOD-XXX (2026-04-10): workflow-transition guard. Features in backlog/defined
  // must be on PO (for grooming), not Builder. Auto-correct if wrong.
  if (
    (type ?? 'task') === 'feature' &&
    ['backlog', 'defined'].includes(effectiveStatus) &&
    effectiveAssignee === 'builder'
  ) {
    effectiveAssignee = 'po'
    routingNote = `${routingNote ? routingNote + ' ' : ''}[guard: feature in ${effectiveStatus} forced to po]`
  }

  const effectiveDescription = routingNote
    ? (description ? `${description}\n\n${routingNote}` : routingNote)
    : description

  const autoRoutingNote = routingNote ? `Auto-assigned: ${routingNote.replace(/^\[|\]$/g, '')}` : ''
  const existingImplNotes = (body.implementation_notes as string | undefined) ?? ''
  const effectiveImplNotes = autoRoutingNote
    ? (existingImplNotes ? `${existingImplNotes}\n${autoRoutingNote}` : autoRoutingNote)
    : existingImplNotes || undefined

  const isTesterIssue = (title ?? '').startsWith('🧪 Tester:') || (title ?? '').includes('Tester: Review')
  if (isTesterIssue || type === 'review') {
    const { data: existingByTitle } = await supabase
      .from('issues')
      .select('id, task_key, status')
      .eq('title', title)
      .not('status', 'in', '("completed","closed","cancelled")')
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
        .not('status', 'in', '("completed","closed","cancelled")')
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

  const generatedIdentity = await prepareIssueIdentity(normalizedProject)

  // Resolve business_id from project → business mapping
  let effectiveBusinessId = body.business_id ?? null
  if (!effectiveBusinessId && normalizedProject) {
    const { data: proj } = await supabase
      .from('projects')
      .select('business_id')
      .eq('name', normalizedProject)
      .maybeSingle()
    if (proj?.business_id) effectiveBusinessId = proj.business_id
  }

  const { data, error } = await supabase
    .from('issues')
    .insert({
      title, description: effectiveDescription, status: finalStatus,
      assignee: effectiveAssignee, project: normalizedProject,
      priority: priority ?? 'medium', type: type ?? 'task', due_date,
      acceptance_criteria, sprint: effectiveSprint, parent_id,
      ...(severity ? { severity } : {}),
      resolution_type, feature_branch, pr_url,
      ...generatedIdentity,
      owner: effectiveOwner,
      ...(effectiveBusinessId ? { business_id: effectiveBusinessId } : {}),
      ...(effectiveImplNotes ? { implementation_notes: effectiveImplNotes } : {}),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── TOD-818: record issue_created event ──
  if (data) {
    const actor = (body.transitioned_by ?? body.assignee ?? null) as string | null
    recordActivityEvent(data.id, data.task_key, 'issue_created', actor, {
      status: data.status,
      assignee: data.assignee,
      project: data.project,
      type: data.type,
      priority: data.priority,
    })
  }

  // Post to #0-created on every new issue. DO NOT REMOVE.
  if (data) {
    try {
      const typeEmoji = TYPE_EMOJI[(data.type as string) ?? 'task'] ?? '📋'
      const key = (data.task_key as string) ?? '?'
      const prioMap: Record<string,string> = {critical:'P0',high:'P1',medium:'P2',low:'P3'}
      const prio = prioMap[(data.priority as string)] ?? (data.priority as string ?? 'medium').toUpperCase()
      const sev = data.severity ? (data.severity as string) : '—'
      const creator = (data.owner as string) ?? (data.assignee as string) ?? 'unknown'
      const msg = `${typeEmoji} **${key}** [${prio}] [${sev}] — ${data.title ?? ''}\n↳ created_by: ${creator}`
      postDiscord('1492576650137964694', msg)
    } catch (e) {
      console.warn('[discord-created] notify failed:', e)
    }
  }

  return NextResponse.json(withIssueStatusCategory(data))
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  // business_id is extracted for hub-scoped query validation, not written back to the issue
  const { id: rawId, task_key, transitioned_by: _transitionedBy, business_id: scopeBusinessId, ...fields } = body
  const transitionedBy = _transitionedBy as string | undefined

  // Hub-scoped query context: when business_id is provided, scope all lookups to that hub
  const hubScope = scopeBusinessId ? getHubClient(scopeBusinessId as string) : null

  let id = rawId
  if (!id && task_key) {
    let lookupQ = createAdminClient().from('issues').select('id').eq('task_key', task_key)
    if (hubScope) lookupQ = lookupQ.eq('business_id', hubScope.businessId)
    const { data: lookup, error: lookupErr } = await lookupQ.single()
    if (lookupErr || !lookup) {
      return NextResponse.json({ error: `No issue found for task_key=${task_key}` }, { status: 404 })
    }
    id = lookup.id
  }
  if (!id) return NextResponse.json({ error: 'id or task_key required' }, { status: 400 })

  let beforeQ = createAdminClient().from('issues').select('*').eq('id', id)
  if (hubScope) beforeQ = beforeQ.eq('business_id', hubScope.businessId)
  const { data: before } = await beforeQ.single()

  if (before?.status === 'closed') {
    return NextResponse.json(
      { error: 'Issue is closed and read-only.' },
      { status: 403 }
    )
  }

  if (fields.status === 'backlog' && before?.status !== 'backlog') {
    const KAOS_ROLES = ['main', 'po', 'ops']
    if (!transitionedBy || !KAOS_ROLES.includes(transitionedBy)) {
      return NextResponse.json(
        { error: 'Only main/po/ops can reset an issue to backlog.', field: 'transitioned_by' },
        { status: 403 }
      )
    }
    fields.implementation_notes = fields.implementation_notes
      ?? `Backlog reset by ${transitionedBy} at ${new Date().toISOString()}.`
    const { data: resetData, error: resetErr } = await supabase
      .from('issues')
      .update({
        ...fields,
        status: 'backlog',
        worked_by: null,
        started_at: null,
        submitted_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()
    if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 500 })
    // TOD-818: record status_changed for backlog reset
    if (resetData && before) {
      recordActivityEvent(
        resetData.id as string,
        (resetData.task_key ?? before.task_key ?? null) as string | null,
        'status_changed',
        transitionedBy ?? null,
        { old_status: before.status, new_status: 'backlog' }
      )
    }
    return NextResponse.json(resetData)
  }

  if (fields.status === 'in_progress') {
    const effectiveWorkedBy = fields.worked_by ?? fields.assignee ?? before?.assignee
    if (effectiveWorkedBy) {
      let activeQ = createAdminClient()
        .from('issues')
        .select('id, task_key, title, started_at')
        .eq('worked_by', effectiveWorkedBy)
        .eq('status', 'in_progress')
        .neq('id', id)
        .limit(1)
      if (hubScope) activeQ = activeQ.eq('business_id', hubScope.businessId)
      const { data: activeIssues } = await activeQ
      if (activeIssues && activeIssues.length > 0) {
        const active = activeIssues[0]
        return NextResponse.json(
          {
            error: `One-at-a-time lane enforcement: ${effectiveWorkedBy} is already working on ${active.task_key} ("${active.title}"). Complete or reset that issue before claiming a new one.`,
            field: 'worked_by',
            active_issue: active.task_key,
          },
          { status: 409 }
        )
      }
    }
  }

  if (fields.priority && !VALID_PRIORITIES.includes(fields.priority as string)) {
    return NextResponse.json(
      { error: `Invalid value for 'priority': "${fields.priority}". Allowed values: ${VALID_PRIORITIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (fields.severity && !VALID_SEVERITIES.includes(fields.severity as string)) {
    return NextResponse.json(
      { error: `Invalid value for 'severity': "${fields.severity}". Allowed values: ${VALID_SEVERITIES.join(', ')}` },
      { status: 400 }
    )
  }
  if (fields.resolution_type && !VALID_RESOLUTION_TYPES.includes(fields.resolution_type as string)) {
    return NextResponse.json(
      { error: `Invalid value for 'resolution_type': "${fields.resolution_type}". Allowed values: ${VALID_RESOLUTION_TYPES.join(', ')}` },
      { status: 400 }
    )
  }
  if (fields.status && !VALID_STATUSES.includes(fields.status as string)) {
    return NextResponse.json(
      { error: `Invalid value for 'status': "${fields.status}". Allowed values: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  if (fields.parent_id !== undefined || fields.type !== undefined) {
    const effectiveType = (fields.type ?? before?.type) as string | undefined
    const effectiveParentId = (fields.parent_id !== undefined ? fields.parent_id : before?.parent_id) as string | null | undefined
    if (effectiveType) {
      const hierErr = await validateHierarchy(effectiveType, effectiveParentId)
      if (hierErr) {
        return NextResponse.json({ error: hierErr.error }, { status: 400 })
      }
    }
  }

  /* ── Open-cap enforcement (backlog-first policy: max 10 open) ── */
  if (fields.status === 'open' && before?.status !== 'open') {
    const MAX_OPEN = 10
    let openCapQ = createAdminClient()
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
    if (hubScope) openCapQ = openCapQ.eq('business_id', hubScope.businessId)
    const { count: openCount } = await openCapQ
    if ((openCount ?? 0) >= MAX_OPEN) {
      return NextResponse.json(
        {
          error: `Backlog-first policy: ${openCount} issues are already open (limit ${MAX_OPEN}). Complete or reset existing open issues before opening new ones.`,
          field: 'status',
          open_count: openCount,
        },
        { status: 409 }
      )
    }
  }

  if (fields.status && before?.status && fields.status !== before.status) {
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
    if (WORKFLOW_TYPES.includes(issueType)) {
      const result = await validateWorkflowTransition(
        before as Record<string, unknown>,
        fields.status as string,
        transitionedBy,
        fields as Record<string, unknown>
      )
      if (result.error) {
        return NextResponse.json(result.error, { status: 400 })
      }
    } else {
      if (fields.status === 'done') {
        return NextResponse.json({ error: "done is retired, use completed or closed" }, { status: 400 })
      }
    }
  }

  if (fields.status) {
    const now = new Date().toISOString()

    if (fields.status === 'in_progress') {
      if (!before?.started_at && !fields.started_at) fields.started_at = now
      const effectiveAssignee = fields.assignee ?? before?.assignee
      if (effectiveAssignee && !fields.worked_by) fields.worked_by = effectiveAssignee
    }

    if (fields.status === 'code_review') fields.submitted_at = now
    if (fields.status === 'code_review') {
      if (fields.tester_notes === undefined && before?.tester_notes == null) fields.tester_notes = null
      if (fields.designer_notes === undefined && before?.designer_notes == null) fields.designer_notes = null
      if (fields.tested_by === undefined && before?.tested_by == null) fields.tested_by = null
      if (fields.designed_by === undefined && before?.designed_by == null) fields.designed_by = null
      if (fields.tester_reviewed_at === undefined && before?.tester_reviewed_at == null) fields.tester_reviewed_at = null
      if (fields.designer_reviewed_at === undefined && before?.designer_reviewed_at == null) fields.designer_reviewed_at = null
    }

    if (fields.status === 'completed') {
      fields.completed_at = now
      const completingAssignee = fields.assignee ?? before?.assignee
      if (completingAssignee && !fields.reviewed_by) fields.reviewed_by = completingAssignee
    }

    applyExecutionStatusRouting(before as Record<string, unknown> | undefined, fields as Record<string, unknown>)

    const issueType = (fields.type ?? before?.type ?? 'task') as string
    if (issueType !== 'task' && fields.status === 'open' && before?.status === 'code_review') {
      fields.rejection_count = (before?.rejection_count ?? 0) + 1
      fields.last_rejected_at = now
      if (fields.reviewer_notes) fields.last_rejection_reason = fields.reviewer_notes
    }
  }

  const transitioningIntoCodeReview = fields.status === 'code_review' && before?.status !== 'code_review'
  const issueTypeForGates = (fields.type ?? before?.type ?? 'task') as string

  // TOD-XXX (2026-04-10 validators requested by Michael):
  // V1 — commit_sha required before in_progress → code_review
  // V2 — regression_test required in the same transition
  // TOD-1205: only enforce for task and bug; feature/epic/ops skip these gates
  if (transitioningIntoCodeReview && ['task', 'bug'].includes(issueTypeForGates)) {
    const mergedNow = { ...before, ...fields } as Record<string, unknown>
    const commitSha = (mergedNow.commit_sha as string | null | undefined) || null
    const regressionTest = (mergedNow.regression_test as string | null | undefined) || null
    if (!commitSha || commitSha === 'none') {
      return NextResponse.json(
        { error: 'commit_sha is required for code_review transition. Run `git rev-parse HEAD` and include the value.', field: 'commit_sha' },
        { status: 422 }
      )
    }
    if (!regressionTest) {
      return NextResponse.json(
        { error: 'regression_test is required for code_review transition. Describe in 1-2 lines how to verify the fix.', field: 'regression_test' },
        { status: 422 }
      )
    }
  }

  // TOD-1203: When a feature transitions to 'defined' and has no parent epic, auto-create one
  const transitioningFeatureToDefined =
    fields.status === 'defined' &&
    before?.status !== 'defined' &&
    (before?.type === 'feature' || fields.type === 'feature')
  if (transitioningFeatureToDefined) {
    const currentParentId = (fields.parent_id ?? before?.parent_id) as string | null | undefined
    if (!currentParentId) {
      const featureTitle = (fields.title ?? before?.title ?? 'Untitled Feature') as string
      const epicTitle = `Epic: ${featureTitle}`
      const featureProject = (fields.project ?? before?.project ?? 'Mission Control') as string
      const epicIdentity = await prepareIssueIdentity(featureProject)
      const { data: newEpic, error: epicErr } = await supabase
        .from('issues')
        .insert({
          title: epicTitle,
          description: `Auto-created epic for feature: ${featureTitle}`,
          type: 'epic',
          status: 'draft',
          priority: (fields.priority ?? before?.priority ?? 'medium') as string,
          project: featureProject,
          assignee: 'main',
          owner: 'main',
          acceptance_criteria: `Parent epic for feature "${featureTitle}". Tracks overall delivery.`,
          ...epicIdentity,
        })
        .select('id, task_key')
        .single()
      if (epicErr || !newEpic) {
        console.error(`[TOD-1203] failed to auto-create epic for feature:`, epicErr?.message)
      } else {
        fields.parent_id = newEpic.id
        console.log(`[TOD-1203] auto-created epic ${newEpic.task_key} as parent for feature transitioning to defined`)
      }
    }
  }

  // V3 — Feature must have ≥1 child task before leaving defined
  // (i.e. feature in `defined` cannot transition to `open` without children)
  const transitioningFeatureOutOfDefined =
    fields.status === 'open' &&
    before?.status === 'defined' &&
    (before?.type === 'feature' || fields.type === 'feature')
  if (transitioningFeatureOutOfDefined) {
    const featureId = before?.id
    if (featureId) {
      const { count: childCount } = await supabase
        .from('issues')
        .select('id', { count: 'exact', head: true })
        .eq('parent_id', featureId)
      if ((childCount ?? 0) < 1) {
        return NextResponse.json(
          { error: 'Feature must have at least 1 child task before transitioning from defined to open. Create child tasks first.', field: 'children' },
          { status: 422 }
        )
      }
    }
  }

  // V4 — closing_notes required for released/completed → closed, and only auditor
  const transitioningToClosed =
    fields.status === 'closed' &&
    (before?.status === 'released' || before?.status === 'completed')
  if (transitioningToClosed) {
    const mergedNow = { ...before, ...fields } as Record<string, unknown>
    const closingNotes = (mergedNow.closing_notes as string | null | undefined) || (mergedNow.reviewer_notes as string | null | undefined) || null
    if (!closingNotes || String(closingNotes).trim().length < 10) {
      return NextResponse.json(
        { error: 'closing_notes (or reviewer_notes) is required to close an issue. Describe the audit outcome in ≥10 chars.', field: 'closing_notes' },
        { status: 422 }
      )
    }
    if (transitionedBy !== 'auditor' && transitionedBy !== 'main' && transitionedBy !== 'michael') {
      return NextResponse.json(
        { error: 'Only auditor can close a released/completed issue. transitioned_by must be auditor.', field: 'transitioned_by' },
        { status: 422 }
      )
    }
  }


  if (before) {
    if (before.status === 'code_review' && ['tester', 'designer', 'ux'].includes(transitionedBy ?? '')) {
      if (transitionedBy === 'tester') {
        if (fields.tester_status === undefined && (fields.tester_notes !== undefined || fields.test_status !== undefined || fields.status !== undefined)) {
          fields.tester_status = fields.test_status === 'failed' || fields.status === 'open' ? 'failed' : 'passed'
        }
        fields.tested_by = transitionedBy
        if (fields.tester_reviewed_at === undefined) fields.tester_reviewed_at = new Date().toISOString()
      }

      if (transitionedBy === 'designer' || transitionedBy === 'ux') {
        if (fields.designer_status === undefined && (fields.designer_notes !== undefined || fields.test_status !== undefined || fields.status !== undefined)) {
          fields.designer_status = fields.test_status === 'failed' || fields.status === 'open' ? 'failed' : 'passed'
        }
        fields.designed_by = transitionedBy === 'ux' ? 'designer' : transitionedBy
        if (fields.designer_reviewed_at === undefined) fields.designer_reviewed_at = new Date().toISOString()
      }
    }

    if (before.status === 'code_review' || transitioningIntoCodeReview || fields.tester_status !== undefined || fields.designer_status !== undefined) {
      const mergedReviewState = { ...before, ...fields } as Record<string, unknown>
      const dual = computeDualReviewState(mergedReviewState)

      if (before.status === 'code_review' && dual.anyFailed) {
        fields.status = 'open'
        fields.assignee = resolveReopenAssignee(before as Record<string, unknown>)
        fields.test_status = 'failed'
        fields.rejection_count = (before?.rejection_count ?? 0) + 1
        fields.last_rejected_at = new Date().toISOString()
        const notes = aggregateReviewerNotes(mergedReviewState)
        if (notes) fields.last_rejection_reason = notes
      } else {
        fields.test_status = dual.overallTestStatus

        if (before.status === 'code_review' && dual.bothPassed && fields.status !== 'open') {
          fields.status = 'approved'
          if (fields.resolution_type === undefined && before?.resolution_type == null) {
            const issueType = (fields.type ?? before?.type ?? 'task') as string
            if (issueType === 'research') fields.resolution_type = 'research_completed'
            else if (issueType === 'ops') fields.resolution_type = 'config_change'
            else fields.resolution_type = 'code_change'
          }
          if (fields.reviewer_notes === undefined) {
            const notes = aggregateReviewerNotes(mergedReviewState)
            if (notes) fields.reviewer_notes = notes
          }
          applyExecutionStatusRouting(before as Record<string, unknown>, fields as Record<string, unknown>)
        }
      }
    }
  }

  const isNewFailure = fields.test_status === 'failed' && before?.test_status !== 'failed'
  if (isNewFailure) {
    fields.fail_count = (before?.fail_count ?? 0) + 1
    if (fields.fail_count >= 3) {
      fields.is_blocked = true
      fields.assignee = 'main'
    }
  }

  // TOD-XXX (2026-04-10): 3-strike loop breaker — auto-block on 3+ rejections.
  // rejection_count is incremented above when dual-review fails; set is_blocked so
  // the Board UI shows the lock icon and the Inbox can prompt for human review.
  // rejection_count is NEVER reset — it persists as an audit trail for retro analysis.
  const newRejectionCount = (fields.rejection_count as number | undefined) ?? before?.rejection_count ?? 0
  if (newRejectionCount >= 3 && !before?.is_blocked) {
    fields.is_blocked = true
  }

  if (fields.owner !== undefined) {
    const currentStatus = before?.status ?? ''
    if (isActiveWorkIssueStatus(currentStatus)) {
      delete fields.owner
    }
  }

  let { data, error } = await supabase
    .from('issues')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error?.code === '42703' || error?.code === 'PGRST204' || (typeof error?.message === 'string' && error.message.includes('schema cache'))) {
    const safeFields = { ...fields }
    for (const col of ['commit_sha', 'implementation_notes', 'reviewer_notes', 'fail_count',
                        'started_at', 'submitted_at', 'completed_at', 'worked_by', 'regression_test',
                        'rejection_count', 'last_rejected_at', 'last_rejection_reason',
                        'reviewer', 'reviewed_by', 'owner', 'deployer', 'auditor', 'transitioned_by',
                        'tester_status', 'tester_notes', 'tested_by', 'tester_reviewed_at',
                        'designer_status', 'designer_notes', 'designed_by', 'designer_reviewed_at']) {
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

  if (fields.status && before?.status && fields.status !== before.status) {
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    const toStatus = fields.status as string
    const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']

    if (WORKFLOW_TYPES.includes(issueType) && data) {
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

  const resolvedType = fields.resolution_type ?? data?.resolution_type
  const issueType = (fields.type ?? before?.type ?? 'task') as string
  const WORKFLOW_TYPES_NOTIFY = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
  if (!WORKFLOW_TYPES_NOTIFY.includes(issueType) && (fields.status === 'approved' || fields.status === 'completed' || fields.status === 'closed') && data) {
    notifyDiscord({ ...data, resolution_type: resolvedType, status: fields.status })
  }

  const NON_ACTIVATING_STATUSES = new Set(['backlog', 'defined', 'closed', 'creation'])
  if (fields.status && data && !NON_ACTIVATING_STATUSES.has(fields.status)) {
    const newAssignee = data.assignee ?? fields.assignee
    if (fields.status === 'code_review') {
      activateCodeReviewAgents(data.task_key ?? '?', data.title ?? '')
    } else if (newAssignee) {
      activateAgentAsync(newAssignee, data.task_key ?? '?', data.title ?? '', fields.status, data.id as string | undefined)
    }
  }

  // SELF-CHAIN CALL — DO NOT REMOVE (protected by .githooks/pre-commit)
  if (fields.status && data && fields.status !== before?.status) {
    selfChainOnStatus(fields.status as string)
  }

  if (fields.pr_url && !before?.pr_url && data) {
    notifyPRReview(data)
  }

  if (isNewFailure && data) {
    notifyTestFailure(data)
    if ((data.fail_count ?? 0) >= 3) notifyEscalation(data)
    // TOD-766: loop breaker — track consecutive failures at the agent level
    const failingAgent = (before?.assignee ?? data.assignee) as string | undefined
    if (failingAgent) {
      recordAgentFailure(failingAgent, id as string, (before?.title ?? data.title) as string | undefined).catch(() => {})
    }
  }

  // TOD-766: reset consecutive failure count when a test passes
  const isNewPass = fields.test_status === 'passed' && before?.test_status !== 'passed'
  if (isNewPass && data) {
    const passingAgent = (before?.assignee ?? data.assignee) as string | undefined
    if (passingAgent) {
      resetAgentFailures(passingAgent).catch(() => {})
    }
  }

  if (isCompletedIssueStatus(fields.status) && before?.assignee === 'ux' && before?.parent_id) {
    const { data: parentData } = await supabase
      .from('issues')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', before.parent_id)
      .select()
      .single()
    if (parentData) notifyDiscord({ ...parentData, resolution_type: parentData.resolution_type ?? 'code_change' })
  }

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

  if (isCompletedIssueStatus(fields.status) && data?.parent_id) {
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
      const allDone = children && children.length > 0 && children.every(c => isCompletedIssueStatus(c.status) || isTerminalIssueStatus(c.status))
      if (allDone) {
        await supabase
          .from('issues')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', data.parent_id)
      }
    }
  }

  // ── TOD-631: In-app notifications on status transitions ──
  if (fields.status && before?.status && fields.status !== before.status && data) {
    const taskKey = data.task_key ?? before.task_key ?? ''
    const title = data.title ?? before.title ?? ''
    const actor = (fields.transitioned_by ?? data.transitioned_by ?? 'system') as string
    supabase.from('notifications').insert({
      type: 'status_change',
      title: `${taskKey} → ${fields.status}`,
      body: title,
      issue_key: taskKey,
      issue_id: data.id,
      actor,
    }).then(() => {}) // fire-and-forget
  }

  // ── TOD-818: Activity event capture ──────────────────────────────────────────
  if (data && before) {
    const issueId = data.id as string
    const issueKey = (data.task_key ?? before.task_key ?? null) as string | null
    const actor = transitionedBy ?? null

    // status_changed
    if (fields.status && before.status && fields.status !== before.status) {
      recordActivityEvent(issueId, issueKey, 'status_changed', actor, {
        old_status: before.status,
        new_status: fields.status,
      })
    }

    // assignee_changed
    if (fields.assignee && before.assignee && fields.assignee !== before.assignee) {
      recordActivityEvent(issueId, issueKey, 'assignee_changed', actor, {
        old_assignee: before.assignee,
        new_assignee: fields.assignee,
      })
    }

    // comment_added — treat non-empty implementation_notes changes as comments
    if (
      fields.implementation_notes &&
      fields.implementation_notes !== before.implementation_notes
    ) {
      recordActivityEvent(issueId, issueKey, 'comment_added', actor, {
        field: 'implementation_notes',
      })
    }

    // reviewer_notes change
    if (
      fields.reviewer_notes &&
      fields.reviewer_notes !== before.reviewer_notes
    ) {
      recordActivityEvent(issueId, issueKey, 'comment_added', actor, {
        field: 'reviewer_notes',
      })
    }
  }

  return NextResponse.json(data ? withIssueStatusCategory(data) : data)
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('issues').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
