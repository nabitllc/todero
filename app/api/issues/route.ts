import { NextRequest, NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
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
import { resolveCallerRole, checkRoutePermission } from '@/lib/permission-check'
import { resolveSessionActor } from '@/lib/session-actor'
import { isOwnerActor } from '@/lib/operator-identity'
import { dbUnavailableResponse } from '@/lib/db-http'

// ── Agent activation map ─────────────────────────────────────────────────────
const ASSIGNEE_AGENT_MAP: Record<string, string | null> = {
  'tester': 'tester',
  'designer': 'designer',
  'ux': 'designer',
  'scout': 'scout',
  'ops': 'ops',
  // no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' mapped to
  // themselves here. Neither agent exists. This map is the activation gate —
  // activateAgentAsync() returns early for any assignee absent from it — so
  // their entries were what let a review transition try to wake a fabricated
  // agent. 'todero-sme' and the real ids stay.
  // TOD-2448: 'todero-sme' was here, carrying the comment "DO NOT REMOVE — SME
  // epic decomposer". No AGENTS.md in this repo declares it — 19 files, one
  // roster table, 14 ids, and it is not among them. A comment asserting a
  // fabrication is real is the strongest version of the defect this file has
  // been swept for three times: it instructs the next reader, acting in good
  // faith, to leave it. Epic decomposition belongs to `po`, which IS declared.
  'main': 'main',
  'KAOS': 'main',
  'builder': 'builder',
  'michael': null,
}

// (No CLAUDE_BIN/WORKSPACE/TODERO_DIR constants here any more: this route stopped
// spawning the CLI directly when activateAgentAsync moved to /api/run-agent, and
// the leftovers pinned Todero to one Mac. Host paths live in lib/paths.ts.)

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
  // no-invented-projects-sweep: this line's comment used to read "kemuni-sme,
  // vespera-sme paused — Todero-only focus". Corrected, not deleted: "paused"
  // says the two agents exist and are coming back. They do not and are not.
  // The guard strips comments before scanning, so it never saw this — a stale
  // comment asserting a fabrication is real is exactly how the entry gets
  // restored by the next reader acting in good faith.
  backlog:        ['po'],  // TOD-2448: 'todero-sme' removed — no roster declares it.
  defined:        ['po'],
  refined:        ['po'],
  open:           ['builder', 'ops', 'scout'],
  underway:       [],
  code_review:    ['tester', 'designer'],
  product_review: ['po'],  // PO is the reviewer; selfChain kicks PO when issue enters product_review
  feature_review: ['po'],  // PO confirms feature completion; selfChain kicks PO on feature_review entry
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

// Kick main when a rejection loop or manual block appears.
// Dependency blocks (blocked_by=<uuid>) are handled by the DB trigger (TOD-607) — no main needed.
function selfChainOnBlocked(isBlocked: boolean | undefined, blockedBy: string | null | undefined) {
  if (!isBlocked) return
  const isRejectionLoop = blockedBy === 'system:rejection_loop'
  const isManualBlock = !blockedBy
  if (!isRejectionLoop && !isManualBlock) return
  void (async () => {
    try {
      await fetch('http://localhost:3000/api/run-agent?agent=main', { method: 'POST' })
    } catch (err) {
      console.warn('[selfChain] main for blocked:', err instanceof Error ? err.message : String(err))
    }
  })()
}

// ── Discord helpers ───────────────────────────────────────────────────────────
const COMPLETED_TASKS_CHANNEL = '1487584901678104698'
const ALERTS_CHANNEL          = '1485333335868834063'
const CREATED_CHANNEL         = '1492576650137964694'

const QUEUE_CHANNEL           = '1494440278524694608' // #1-queue
// TOD-2424: a live Discord bot token was a source literal here, used as the
// fallback whenever the env var was unset. It is gone, and there is no fallback
// constant to replace it — a credential that can be read from the repo is a
// credential every clone carries.
//
// The token was also DEAD: POST to Discord with it returns 401. Every
// notification this file has sent recently failed silently, because the fetch
// below swallows its result in .catch(). Rotate in the Discord Developer Portal
// and store the new one per hub via Settings -> Connections (migration 059);
// lib/connections.ts resolveHubDiscord() returns it, or null, never a constant.

// no-invented-projects-sweep: a `PROJECT_EMOJI` table stood here, mapping
//   Vespera: '🖤', Kemuni: '🚀', 'Mission Control': '🧠', Infrastructure: '⚙️'
// Two of those four keys were projects that do not exist. The whole
// declaration is gone rather than trimmed to its two real keys, and that is
// deliberate — see below.
//
// WHY THIS ONE SURVIVED THREE SWEEPS (docs/rebuild/HANDOFF.md counts two before
// this piece). It is DEAD CODE. Nothing in the repository ever read
// PROJECT_EMOJI: a full-tree grep matches this file and the guard's own header
// prose, and nothing else. A sweep that reasons from call sites — "what breaks
// if this goes?" — gets the answer "nothing", finds no reader to follow, and
// leaves it alone. Only a check that inspects DECLARATIONS rather than USAGE
// sees it at all, which is check 3 in scripts/no-invented-projects.mjs.
//
// So the table is not reduced to `{ 'Mission Control': '🧠', Infrastructure: '⚙️' }`.
// A two-key dead table is still dead, still unread, and still an empty slot
// shaped exactly like the one a future session refilled twice. If a project
// emoji is ever genuinely needed, derive it where it is rendered, from
// PROJECT_PREFIX in lib/constants.ts — the one canonical list.

function postDiscord(channelId: string, content: string) {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    // Say nothing was sent, rather than posting with a fallback nobody set.
    console.warn('[discord] no credential configured — not posting to', channelId)
    return
  }
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
  backlog: '📥', refined: '✅', defined: '📐', draft: '📝',
  open: '🟢', in_progress: '🔨',
  code_review: '👀', product_review: '🧐', feature_review: '🎯',
  underway: '⚡', active: '🔥',
  approved: '🚢', completed: '🏁', wrapped: '📦', released: '🚀',
  closed: '🔒', escalated: '🚨', failed: '❌',
}
const TYPE_EMOJI: Record<string, string> = {
  task: '📋', bug: '🐛', feature: '✨', epic: '🏔️', ops: '⚙️', research: '🔍'
}
const PRIORITY_EMOJI: Record<string, string> = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '🟢'
}
const SEVERITY_EMOJI: Record<string, string> = {
  S0: '🔴', S1: '🟠', S2: '🟡', S3: '🟢'
}

// ── GET response cache (30s TTL, keyed by query string) ───────────────────────
const issuesCache = new Map<string, { data: unknown; ts: number }>()
const ISSUES_CACHE_TTL = 30_000

function fmtDiscordMsg(
  issue: Record<string, unknown>,
  toStatus: string,
  actor?: string,
  parentKey?: string | null,
  fromStatus?: string | null
): string {
  const typeEmoji = TYPE_EMOJI[(issue.type as string) ?? 'task'] ?? '📋'
  const toEmoji = STATUS_EMOJI[toStatus] ?? '✅'
  const statusPart = fromStatus
    ? `${STATUS_EMOJI[fromStatus] ?? ''}→${toEmoji}`
    : toEmoji
  const key = (issue.task_key ?? '?') as string
  const prio = issue.priority as string | undefined
  const prioEmoji = prio ? `P${PRIORITY_EMOJI[prio] ?? prio}` : null
  const sev = issue.severity as string | undefined
  const sevEmoji = sev ? `S${SEVERITY_EMOJI[sev] ?? sev}` : null
  const by = actor ?? (issue.assignee as string) ?? 'unknown'
  const meta: string[] = [by]
  if (prioEmoji) meta.push(prioEmoji)
  if (sevEmoji) meta.push(sevEmoji)
  if (parentKey) meta.push(parentKey)
  return `${statusPart} | ${typeEmoji} **${key}** — ${issue.title ?? ''}\n↳ By: ${meta.join(' · ')}`
}

function fmtDiscordMsgClosed(
  issue: Record<string, unknown>,
  actor?: string,
  parentKey?: string | null,
  fromStatus?: string | null
): string {
  const typeEmoji = TYPE_EMOJI[(issue.type as string) ?? 'task'] ?? '📋'
  const fromEmoji = fromStatus ? (STATUS_EMOJI[fromStatus] ?? '') : ''
  const key = (issue.task_key ?? '?') as string
  const resolution = (issue.resolution_type as string) ?? ''
  const prio = issue.priority as string | undefined
  const prioEmoji = prio ? `P${PRIORITY_EMOJI[prio] ?? prio}` : null
  const sev = issue.severity as string | undefined
  const sevEmoji = sev ? `S${SEVERITY_EMOJI[sev] ?? sev}` : null
  const by = actor ?? (issue.assignee as string) ?? 'unknown'
  const meta: string[] = [by]
  if (prioEmoji) meta.push(prioEmoji)
  if (sevEmoji) meta.push(sevEmoji)
  if (parentKey) meta.push(parentKey)
  const statusPart = fromEmoji ? `${fromEmoji}→🔒` : '🔒'
  return `${typeEmoji} **${key}** — ${issue.title ?? ''}\n↳ ${statusPart} | ${resolution}\n↳ By: ${meta.join(' · ')}`
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

function notifyDiscord(issue: { task_key?: string; title?: string; assignee?: string; severity?: string; status?: string; type?: string; priority?: string }) {
  postDiscord(COMPLETED_TASKS_CHANNEL, fmtDiscordMsg(issue as Record<string, unknown>, issue.status ?? 'completed'))
}

function notifyEscalation(issue: { task_key?: string; title?: string; project?: string; acceptance_criteria?: string; type?: string; priority?: string; assignee?: string; severity?: string }) {
  const ac = (issue.acceptance_criteria ?? '').slice(0, 200)
  const base = fmtDiscordMsg(issue as Record<string, unknown>, 'escalated', 'kaos')
  postDiscord(ALERTS_CHANNEL, `🚨 ${base}\n⚠️ 3 failed reviews · AC: ${ac || 'none'}\n<@409194957098713088> manual investigation required.`)
}

function notifyTestFailure(issue: { task_key?: string; title?: string; description?: string; type?: string; priority?: string; assignee?: string; severity?: string }) {
  const desc = issue.description ?? ''
  const notes = ((desc.includes('---') ? desc.split('---').pop()?.trim() : desc) ?? '').slice(0, 300) || 'No details provided'
  postDiscord(ALERTS_CHANNEL, `🚨 ${fmtDiscordMsg(issue as Record<string, unknown>, 'failed')}\n↳ Tester notes: ${notes}`)
}

// ── TOD-1226 / TOD-1236: Watcher notifications on resolution ─────────────────
// Fire-and-forget: send a Discord DM (or channel post) per watcher when an
// issue transitions to completed or closed. Failure never blocks the PATCH.
function notifyWatchers(issue: {
  task_key?: string
  title?: string
  resolution_type?: string
  implementation_notes?: string
  closing_notes?: string
  watchers?: string[] | null
}) {
  const watchers = issue.watchers
  if (!watchers || watchers.length === 0) return

  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.warn('[discord] no credential configured — not notifying watchers')
    return
  }
  const key = issue.task_key ?? '?'
  const resType = RESOLUTION_LABELS[issue.resolution_type ?? ''] ?? (issue.resolution_type ?? 'Resolved')
  const notes = (issue.closing_notes ?? issue.implementation_notes ?? 'No closing notes provided.').slice(0, 400)
  const link = `https://kaos.nabit.work`
  const msg = `✅ **Resolved: [${key}]** ${issue.title ?? ''}\n**Resolution:** ${resType}\n**Notes:** ${notes}\n🔗 ${link}\n\n_To unsubscribe from this issue: <https://kaos.nabit.work/unwatch?issue=${encodeURIComponent(key)}>_`

  for (const watcher of watchers) {
    void (async () => {
      try {
        // Determine channel to post to.
        // If watcher is a raw snowflake ID (user), open a DM channel first.
        // If it already looks like a channel mention (<#id>) or channel ID, post directly.
        let channelId: string | null = null
        const channelMentionMatch = watcher.match(/^<#(\d+)>$/)
        if (channelMentionMatch) {
          channelId = channelMentionMatch[1]
        } else if (/^\d{17,20}$/.test(watcher)) {
          // Raw snowflake — treat as Discord user ID, open DM channel
          const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
            },
            body: JSON.stringify({ recipient_id: watcher }),
          })
          if (dmRes.ok) {
            const dmData = await dmRes.json() as { id?: string }
            channelId = dmData.id ?? null
          } else {
            console.warn(`[notifyWatchers] DM channel open failed for ${watcher}: ${dmRes.status}`)
          }
        }
        if (channelId) {
          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': `Bot ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
            },
            body: JSON.stringify({ content: msg }),
          })
        }
      } catch (err) {
        console.warn(`[notifyWatchers] failed for watcher ${watcher}:`, err instanceof Error ? err.message : String(err))
      }
    })()
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────
// Lazy-init: avoids crashing at build time when the database credentials aren't
// set (CI builds import every route for page-data collection). Throws at first
// request instead of at module load, so `next build` can complete without the
// env var. (TOD-2296 — same pattern as app/api/run-agent/route.ts.)
let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// ── Activity event capture ────────────────────────────────────────────────────
// no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were members here.
// Neither agent exists. Membership decides actor_type on every recorded
// activity event, so either id would have been written to the event log as
// actor_type 'agent'; absent, they classify as 'human', which is wrong too but
// is at least not an assertion that a nonexistent agent acted.
const KNOWN_AGENT_IDS = new Set([
  'builder', 'tester', 'designer', 'ux', 'scout', 'ops',
  'main', 'KAOS', 'auditor',
  'deployer', 'po', 'monitor-stale', 'heartbeat',
])

function resolveActorType(actor: string | null | undefined): 'agent' | 'human' {
  if (!actor) return 'human'
  return KNOWN_AGENT_IDS.has(actor) ? 'agent' : 'human'
}

// Round-4 fix: this used to be `void … .then(() => {})` — a fire-and-forget
// insert whose error nobody ever read. On this install `activity_events`
// doesn't exist (see /api/health), so EVERY call silently failed on every
// issue operation and every caller reported success anyway. Now awaited and
// honest: callers collect {ok, error} and surface it as `_warning` on the
// response instead of a bare 200 that implies the event was recorded.
async function recordActivityEvent(
  issueId: string,
  issueKey: string | null | undefined,
  eventType: string,
  actor: string | null | undefined,
  metadata: Record<string, unknown>
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await getSupabase().from('activity_events').insert({
    issue_id: issueId,
    issue_key: issueKey ?? null,
    event_type: eventType,
    actor: actor ?? null,
    actor_type: resolveActorType(actor),
    metadata,
  })
  if (error) {
    console.warn(`[activity-event] ${eventType} on ${issueKey ?? issueId} not recorded:`, error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true, error: null }
}

/** Folds a batch of recordActivityEvent() outcomes into one `_warning` string, or null if all ok. */
function activityEventWarning(outcomes: Array<{ ok: boolean; error: string | null }>): string | null {
  const failed = outcomes.filter(o => !o.ok)
  if (failed.length === 0) return null
  const uniqueErrors = Array.from(new Set(failed.map(f => f.error ?? 'unknown error')))
  return `activity event not recorded — ${uniqueErrors.join('; ')}`
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
    const { data: parent, error: dbErr } = await getSupabase()
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
      const { data: parent, error: dbErr } = await getSupabase()
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

  // Atomic sequence via DB function — no TOCTOU race condition possible.
  // next_issue_number() does an atomic UPDATE...RETURNING on the issue_sequences
  // table, guaranteeing each caller gets a unique number even under concurrent load.
  // Migration 021_issue_sequences.sql must be applied before this runs.
  const { data: seqData, error: seqErr } = await createAdminClient()
    .rpc('next_issue_number', { p_prefix: prefix })

  if (!seqErr && typeof seqData === 'number') {
    return { task_key: `${prefix}-${seqData}`, task_number: seqData }
  }

  // Fallback: MAX-based scan with retry loop (used if sequence table not yet migrated).
  console.warn(`[issues] sequence RPC unavailable (${seqErr?.message}), falling back to MAX scan`)
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: maxRow } = await createAdminClient()
      .from('issues')
      .select('task_number')
      .like('task_key', `${prefix}-%`)
      .not('task_number', 'is', null)
      .order('task_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextNumber = ((maxRow as { task_number?: number } | null)?.task_number ?? 0) + 1 + attempt
    const candidateKey = `${prefix}-${nextNumber}`

    const { data: existing } = await createAdminClient()
      .from('issues')
      .select('id')
      .eq('task_key', candidateKey)
      .maybeSingle()

    if (!existing) {
      return { task_key: candidateKey, task_number: nextNumber }
    }
    console.warn(`[issues] task_key ${candidateKey} already exists, retrying (attempt ${attempt + 1})`)
  }


  // Final fallback: timestamp suffix
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

  const { data: transition, error: dbErr } = await getSupabase()
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
    // michael can override any workflow transition for maintenance/admin purposes
    if (isOwnerActor(transitionedBy)) {
      return { transition: { condition_role: null, validators: [], post_functions: [] } as unknown as WorkflowTransition, error: null }
    }
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

  // michael is a global admin bypass — can execute any transition regardless of conditionRole.
  // DO NOT REMOVE — maintenance transitions (e.g. resetting stale claims) require this.
  if (isOwnerActor(transitionedBy)) {
    return { transition: transition as WorkflowTransition, error: null }
  }

  if (conditionRole === 'po_or_main') {
    // 'main' kept for backward compat; canonical human identity is 'michael'; kaos is orchestrator
    if (!transitionedBy || !['po', 'main', 'michael', 'kaos'].includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po, michael, or kaos can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'po_main_sme') {
    // no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were in this
    // allowlist. Neither agent exists. This is an AUTHORIZATION list — it named
    // two nonexistent principals as permitted to execute a guarded workflow
    // transition. Removing them narrows the allowlist; it cannot widen it.
    const allowed = ['po', 'main', 'michael', 'kaos']  // TOD-2448: 'todero-sme' removed.
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po, michael, kaos, or an SME can execute this transition', field: 'transitioned_by' } }
    }
  } else if (conditionRole === 'po_main_ops') {
    const allowed = ['po', 'main', 'michael', 'kaos', 'ops']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only po, michael, kaos, or ops can execute this transition', field: 'transitioned_by' } }
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
  } else if (conditionRole === 'cron_or_michael_or_kaos') {
    // refined→open is owned by the queue-refill cron, michael (admin), or kaos (orchestrator).
    // Agents and PO must not promote to open directly — the cron maintains queue depth.
    const allowed = ['cron-queue-refill', 'michael', 'kaos']
    if (!transitionedBy || !allowed.includes(transitionedBy)) {
      return { transition: null, error: { error: 'Only the queue-refill cron, michael, or kaos can move issues to open. The cron runs every 30 min and maintains queue depth automatically.', field: 'transitioned_by' } }
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
        const { count } = await getSupabase()
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
    const { data: parentEpic } = await getSupabase()
      .from('issues')
      .select('id, status, type, task_key')
      .eq('id', issue.parent_id as string)
      .single()
    if (parentEpic?.type === 'epic' && ['backlog', 'draft'].includes(parentEpic.status)) {
      const { error: activateErr } = await getSupabase()
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
  const { data, error } = await getSupabase()
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
      const fromStatus = issue.status as string | undefined
      const notifyIssue = { ...issue, ...updatedIssue, ...(fields as Record<string, unknown>), status: toStatus } as Record<string, unknown>
      const actor = (fields.transitioned_by ?? notifyIssue.assignee ?? 'unknown') as string
      let parentKey: string | null = null
      if (notifyIssue.parent_id) {
        const { data: par } = await getSupabase().from('issues').select('task_key').eq('id', notifyIssue.parent_id as string).maybeSingle()
        parentKey = par?.task_key ?? null
      }
      if (toStatus === 'closed') {
        postDiscord(channelId, fmtDiscordMsgClosed(notifyIssue, actor, parentKey, fromStatus))
      } else {
        postDiscord(channelId, fmtDiscordMsg(notifyIssue, toStatus, actor, parentKey, fromStatus))
      }
    }

    if (action === 'notify_rejection') {
      const fromStatus = issue.status as string | undefined
      const notifyIssue = { ...issue, ...updatedIssue, ...(fields as Record<string, unknown>), status: toStatus } as Record<string, unknown>
      const actor = (fields.transitioned_by ?? notifyIssue.assignee ?? 'unknown') as string
      const notes = (notifyIssue.tester_notes ?? notifyIssue.designer_notes ?? notifyIssue.reviewer_notes ?? notifyIssue.last_rejection_reason ?? '') as string
      const count = (notifyIssue.rejection_count as number) ?? 1
      let parentKey: string | null = null
      if (notifyIssue.parent_id) {
        const { data: par } = await getSupabase().from('issues').select('task_key').eq('id', notifyIssue.parent_id as string).maybeSingle()
        parentKey = par?.task_key ?? null
      }
      const base = fmtDiscordMsg(notifyIssue, toStatus, actor, parentKey, fromStatus)
      postDiscord(QUEUE_CHANNEL, `${base}\n↳ Rejection #${count}${notes ? ` · ${notes.slice(0, 150)}` : ''}`)
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

    if (action === 'set_field') {
      const fieldName = params.field as string
      const fieldValue = params.value as string
      fields[fieldName] = fieldValue
    }

    if (action === 'set_timestamp') {
      const tsField = params.field as string
      fields[tsField] = new Date().toISOString()
    }

    if (action === 'set_active_sprint') {
      // Always set sprint to active sprint when transitioning (refined→open, defined→underway)
      const project = (fields.project ?? updatedIssue.project ?? issue.project) as string | null | undefined
      if (project) {
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
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  const REQUIRED_PERMISSION = 'issues:read' as const
  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'GET', '/api/issues')
    if (!perm.allowed) return NextResponse.json(perm.body, { status: perm.status })
  }

  const url = new URL(req.url)
  const taskKey = url.searchParams.get('task_key')

  if (taskKey) {
    // Task keys are globally unique, which made this look like a safe shortcut:
    // no hub scope needed, straight to an admin client. It ran BEFORE every
    // scope check below and returned the FULL row — description included — for
    // any key, from any page. A row a Limiglow operator is refused on a list
    // read was handed over in full by guessing its key.
    //
    // Uniqueness is why the lookup needs no filter to FIND the row. It is not a
    // reason to let a scoped caller READ it.
    const scope = req.headers.get('x-mc-project')
    const crossProject = req.headers.get('x-mc-all-projects') === '1'
    const allProjects = ['1', 'true', 'yes'].includes(
      (url.searchParams.get('all_projects') ?? '').toLowerCase()
    )
    const { data, error } = await createAdminClient()
      .from('issues')
      .select('*')
      .eq('task_key', taskKey)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: `No issue found for task_key=${taskKey}` }, { status: 404 })
    // TOD-2420: `allProjects` used to appear in this condition, so a
    // CLIENT-CONTROLLED query string (`?all_projects=1`) defeated the very
    // boundary the comment below says this 404 exists to hold. The header
    // `x-mc-all-projects` stays because middleware.ts owns it and strips a
    // forged one — the scope guard proves that. A query param has no such
    // protection: anyone who can type a URL can set it.
    // TOD-2427. This branch used to gate its 404 on `if (scope && ...)`, so
    // whenever NO scope resolved it returned the full row for ANY key. Two
    // callers hit that, and both were measured, not theorised:
    //
    //   1. no Referer at all -> 200, full row. Anyone holding the session
    //      cookie could enumerate every key in every project by curl, while
    //      the LIST read on this same route answered 400 for that identical
    //      caller. One route, two opposite answers to the same question.
    //   2. a cross-project destination (fleet/*, runs/*, settings/projects),
    //      where middleware deliberately resolves no scope. Reproduced live:
    //      TOD-1 (project Todero) returned 200 from a Limiglow Fleet page, and
    //      SearchOverlay had to filter it out client-side to avoid printing it.
    //
    // So an unresolvable scope now REFUSES, exactly as the list path does, and
    // says how to ask deliberately. An explicit `?project=` establishes scope
    // for a scope-blind caller; a foreign key under that project still 404s.
    // The `x-mc-all-projects` header still bypasses, because middleware owns it
    // and the scope guard proves a forged one is ignored — unlike a query
    // string, which is whatever the caller types.
    const keyScope = scope || url.searchParams.get('project')
    if (!keyScope && !crossProject) {
      return NextResponse.json(
        {
          error: 'unscoped_issues_read',
          message:
            `Looking up task_key=${taskKey} has no project scope. Request it from a ` +
            `/p/<project> screen, or pass project=<name> to name the scope deliberately.`,
        },
        { status: 400 },
      )
    }
    if (keyScope && !crossProject && data.project !== keyScope) {
      // 404, deliberately, not 403: a scoped caller should not be able to use
      // this endpoint to discover which keys exist outside its own project.
      return NextResponse.json({ error: `No issue found for task_key=${taskKey}` }, { status: 404 })
    }
    return NextResponse.json(withIssueStatusCategory(data))
  }

  // scope-reaches-the-server: the result for an identical query string now
  // also depends on the caller's resolved scope (see `effectiveProject`
  // below) — the same `?limit=0` from a Limiglow-scoped tab and a Todero-
  // scoped tab must not share a cache entry, or whichever populated it first
  // wins for both until the 30s TTL expires.
  const cacheKey = url.search + '|' + (req.headers.get('x-mc-project') ?? '')
  const cached = issuesCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < ISSUES_CACHE_TTL) {
    return NextResponse.json(cached.data)
  }

  const search = url.searchParams.get('search')
  // TOD-1999: default limit=50 keeps no-param responses under 200KB.
  // Pass ?limit=0 for unbounded (agent/script callers, batched below the
  // PostgREST row cap). ?page=N for offset. MAX_LIMIT bounds any *positive*
  // limit so one request can't ask Postgres for an unreasonable page size —
  // it deliberately does not apply to the limit=0 sentinel, which has
  // different semantics ("every row, fetched in MAX_LIMIT-sized batches")
  // and is relied on by FeaturesTab/IssuesTab/ProjectsTab/EpicMapTab/etc to
  // get a true, untruncated count.
  const MAX_LIMIT = 1000
  const limitParam = url.searchParams.get('limit')
  let limit = 50
  if (limitParam !== null) {
    const trimmed = limitParam.trim()
    if (!/^\d+$/.test(trimmed)) {
      return NextResponse.json(
        { error: `Invalid limit "${limitParam}" — must be a non-negative integer (0 = unbounded, max ${MAX_LIMIT}).` },
        { status: 400 },
      )
    }
    limit = Math.min(parseInt(trimmed, 10), MAX_LIMIT)
  }
  const pageParam = url.searchParams.get('page')
  let page = 1
  if (pageParam !== null) {
    const trimmed = pageParam.trim()
    if (!/^\d+$/.test(trimmed) || parseInt(trimmed, 10) < 1) {
      return NextResponse.json(
        { error: `Invalid page "${pageParam}" — must be a positive integer.` },
        { status: 400 },
      )
    }
    page = parseInt(trimmed, 10)
  }
  const offset = limit > 0 ? (page - 1) * limit : 0
  const projectParam = url.searchParams.get('project')
  const businessIdParam = url.searchParams.get('business_id')
  const assigneeParam = url.searchParams.get('assignee')
  const statusParam = url.searchParams.get('status')
  // TOD-2416: `type` was read nowhere on this GET, so `?type=epic` was accepted
  // and silently ignored — an Epics card asking for a count of epics got a
  // count of every issue. That is the "parameter accepted and then ignored"
  // defect this rebuild already paid a round for. Validated against the same
  // VALID_TYPES the POST path uses, so an unknown type refuses rather than
  // returning an unfiltered set that looks like a real answer.
  const typeParam = url.searchParams.get('type')
  // TOD-2420: `has_due=1` narrows to rows that actually carry a due date.
  // Without it the Work "What is due?" card had no way to ask its own question
  // and rendered the project total instead — a card whose printed query
  // visibly did not match its title.
  const hasDueParam = url.searchParams.get('has_due')
  if (hasDueParam !== null && hasDueParam !== '1' && hasDueParam !== '0') {
    return NextResponse.json(
      { error: `Invalid has_due "${hasDueParam}" — must be 1 or 0.` },
      { status: 400 },
    )
  }
  if (typeParam !== null && !VALID_TYPES.includes(typeParam)) {
    return NextResponse.json(
      { error: `Invalid type "${typeParam}" — allowed: ${VALID_TYPES.join(', ')}.` },
      { status: 400 },
    )
  }

  // ─── scope-reaches-the-server ───────────────────────────────────────────
  //
  // "GET /api/issues without a project should not silently mean 'all
  // projects'." Plain "refuse when omitted" was tried first and rejected: it
  // breaks `rbac-owner-reads` and the `issues-paginated` / no-truncation
  // checks in scripts/acceptance/checks*.mjs, all of which call bare
  // `GET /api/issues` with only an auth cookie — no project, no page context
  // — and correctly expect 200. Those calls are genuinely scope-blind (a
  // script, not a page); refusing them would be wrong, not honest.
  //
  // The actual bug was narrower: callers that DO have a scope (a browser tab
  // sitting on a `/p/<slug>` page) sent no `project=` and got everything
  // anyway, because nothing here read the ONE signal that WAS available —
  // middleware.ts's resolved scope, stamped on `x-mc-project` (from this
  // request's own path, or its Referer; see that file's block comment).
  // `?project=` explicit still wins outright; a resolved scope is now used
  // exactly as if the caller had passed it.
  //
  // TOD-2420: this used to describe `?all_projects=1` as "the explicit opt-out
  // for a caller that wants every project on purpose even though a scope was
  // resolvable", and then, in the same sentence, as "read but ignored on
  // purpose". Both halves were in the file at once; a critic read the first and
  // reported a parameter accepted and ignored. The second half was the true
  // one, and the behaviour it describes is CORRECT and deliberate:
  //
  //   On list reads `?all_projects=1` does nothing, because a query string is
  //   client-controlled and widening scope from one would be a scope escape any
  //   browser tab could type. Widening happens only through the server-set
  //   `x-mc-all-projects` header, which middleware.ts owns and which the scope
  //   guard proves cannot be forged.
  //
  // The param is still PARSED on the task_key branch above so an explicit
  // caller is distinguishable from an absent-minded one in logs — it no longer
  // grants anything.
  //
  // ProjectsTab (settings/projects) and the Fleet/Runs aggregates are
  // deliberately cross-project (build instruction 4) — middleware.ts never
  // resolves a scope for those destinations in the first place (see its
  // `isCrossProjectDestination`), so they fall through to "no header, all
  // projects" here without this route needing to know their names.
  const allProjectsParam = ['1', 'true', 'yes'].includes(
    (url.searchParams.get('all_projects') ?? '').toLowerCase()
  )
  const resolvedScope = req.headers.get('x-mc-project')
  const crossProjectDestination = req.headers.get('x-mc-all-projects') === '1'

  // The reasoning above was honest and still wrong in its conclusion. It
  // declined to refuse an omitted scope because three acceptance checks call
  // bare GET /api/issues and expect 200. But those are SCRIPTS, and a script
  // can say what it means — they now pass all_projects=1, which is exactly the
  // explicit opt-out this route already defined and then never required.
  //
  // Leaving it open meant the two halves of one seam answered the identical
  // condition oppositely: no resolvable scope 400s on /api/db/issues and
  // returned every project here — on the route EpicMapTab, ChatTab, IssuesTab,
  // FeaturesTab, ProductBoardTab and ProjectsTab all read.
  if (!resolvedScope && !allProjectsParam && !crossProjectDestination && !projectParam) {
    return NextResponse.json(
      {
        error: 'unscoped_issues_read',
        message:
          'This issues query has no project scope. Request it from a /p/<project> screen, ' +
          'or pass all_projects=1 to read across every project deliberately.',
      },
      { status: 400 },
    )
  }

  // A resolved scope NARROWS; it is never overridden. `?project=` used to win
  // outright, so a page scoped to Limiglow could ask for Todero's rows and get
  // them. A mismatch is now refused rather than silently answered — answering
  // it would make the address bar and the data disagree.
  if (projectParam && resolvedScope && projectParam !== resolvedScope) {
    return NextResponse.json(
      {
        error: 'project_outside_scope',
        message: `This screen is scoped to "${resolvedScope}"; it cannot request "${projectParam}".`,
      },
      { status: 400 },
    )
  }

  const effectiveProject = resolvedScope || projectParam || null

  // Hub-scoped query when business_id provided; fallback to admin for aggregate queries
  const hub = businessIdParam ? getHubClient(businessIdParam) : null
  const baseClient = hub ? hub.client : createAdminClient()
  //
  // Select specific columns by default (excludes large text blobs: description,
  // implementation_notes, reviewer_notes, regression_test, tester_notes,
  // designer_notes) to keep response payloads small (~5KB vs ~200KB).
  // Pass ?full=true to get all columns (used by agents that need full detail).
  const fullFields = url.searchParams.get('full') === 'true'
  const SELECT_COLS = [
    'id','task_key','task_number','title','status','type','priority','severity',
    'assignee','owner','sprint','project','due_date',
    'created_at','updated_at','started_at','submitted_at','completed_at',
    'is_blocked','blocked_by','parent_id','feature_branch','pr_url','commit_sha',
    'tester_status','tested_by','tester_reviewed_at',
    'designer_status','designed_by','designer_reviewed_at',
    'deployer_status','deployer_notes',
    'worked_by','transitioned_by','acceptance_criteria',
    'business_id','resolution_type',
    // archived_at/archived_reason are read on EVERY request, including the
    // default one, because the archive filter below is applied here in the
    // query layer. A caller must be able to tell an archived row from a live
    // one; before this, the column existed in the database and was simply
    // absent from every response, which reads as "nothing is archived".
    'archived_at','archived_reason',
  ].join(',')

  // Archived rows are hidden by default and reachable with ?include_archived=1.
  //
  // The filter belongs HERE, in the one place the issues query is built, and
  // not at each call site: a filter scattered across callers is a filter a new
  // caller forgets, and the failure mode is silent — history quietly reappears
  // on a board that is supposed to show one project.
  const includeArchived = ['1', 'true', 'yes'].includes(
    (url.searchParams.get('include_archived') ?? '').toLowerCase()
  )
  const parentIdParam = url.searchParams.get('parent_id')

  // Rebuildable per batch: PostgREST/Supabase caps a single request's rows at
  // its own server-side max (commonly 1000) regardless of what .range() asks
  // for, so a query object can't just be re-awaited to get "the rest" — a
  // fresh builder has to be issued per page. Everything above ?limit=0's
  // request just gets one page of it; ?limit=0 below pages through all of
  // them itself instead of trusting a single response to be complete.
  function buildQuery() {
    let q = baseClient.from('issues').select(fullFields ? '*' : SELECT_COLS, { count: 'exact' })
    if (!includeArchived) q = q.is('archived_at', null)
    if (hub) q = q.eq('business_id', hub.businessId)
    if (effectiveProject) q = q.eq('project', effectiveProject)
    if (assigneeParam) q = q.eq('assignee', assigneeParam)
    if (statusParam) q = q.eq('status', statusParam)
    if (typeParam) q = q.eq('type', typeParam)
    if (hasDueParam === '1') q = q.not('due_date', 'is', null)
    if (hasDueParam === '0') q = q.is('due_date', null)
    if (parentIdParam) q = q.eq('parent_id', parentIdParam)
    if (search) {
      q = q.ilike('title', `%${search}%`)
      q = q.order('updated_at', { ascending: false })
    } else {
      q = q.order('created_at', { ascending: false })
    }
    return q
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] = []
  let total = 0

  if (limit > 0) {
    // A head-only count first: PostgREST answers `.range(offset, ...)` with a
    // raw "Requested range not satisfiable" error once offset is past the end
    // of the result set (e.g. paging past the last page, or a stale ?page=
    // after rows were deleted). Knowing total up front lets an out-of-range
    // offset return an honest empty page instead of leaking that error.
    const { count: headCount, error: headError } = await buildQuery().range(0, 0)
    if (headError) return NextResponse.json({ error: headError.message }, { status: 500 })
    total = headCount ?? 0
    if (total === 0 || offset >= total) {
      data = []
    } else {
      const { data: page, error, count } = await buildQuery().range(offset, offset + limit - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      data = page ?? []
      total = count ?? total
    }
  } else {
    // ?limit=0 means "every matching row" (agent/script callers). PostgREST's
    // per-request row cap means that has to be assembled from multiple
    // batched requests, not a single unbounded one — a single request here
    // used to come back truncated at ~1000 rows while claiming has_more=false.
    const BATCH = 1000
    let from = 0
    for (;;) {
      const { data: batch, error, count } = await buildQuery().range(from, from + BATCH - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      total = count ?? 0
      const rows = batch ?? []
      data = data.concat(rows)
      from += BATCH
      if (rows.length < BATCH || data.length >= total) break
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultData = withIssueStatusCategoryList(data as any[])
  const hasMore = limit > 0 ? offset + data.length < total : false
  const responseBody = { data: resultData, total, page, limit, has_more: hasMore }
  issuesCache.set(cacheKey, { data: responseBody, ts: Date.now() })
  const res = NextResponse.json(responseBody)
  res.headers.set('X-Total-Count', String(total))
  return res
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'POST', '/api/issues')
    if (!perm.allowed) {
      return NextResponse.json(perm.body, { status: perm.status })
    }
  }

  const body = await req.json()
  const { title, description, status, assignee, project, priority, type, due_date,
          acceptance_criteria, sprint, parent_id, severity, resolution_type,
          feature_branch, pr_url, task_key: _clientKey, task_number: _clientNum, owner } = body

  const normalizedProject = normalizeProjectName(project)

  const missing: string[] = []
  if (!title?.trim())                missing.push('title')
  if (!normalizedProject.trim())     missing.push('project')
  if (!description?.trim())          missing.push('description')
  if (!acceptance_criteria?.trim())  missing.push('acceptance_criteria')

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Cannot create issue — missing required fields: ${missing.join(', ')}. Every issue must have a description and acceptance criteria before work begins.` },
      { status: 400 }
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

  const hierarchyErr = await validateHierarchy(type ?? 'task', parent_id)
  if (hierarchyErr) {
    return NextResponse.json({ error: hierarchyErr.error }, { status: 400 })
  }

  // Hub SME by project — used for epic owner/assignee
  //
  // no-invented-projects-sweep: two branches stood at the top of this function,
  //   if (proj === 'Kemuni')  return 'kemuni-sme'
  //   if (proj === 'Vespera') return 'vespera-sme'
  // and this is a WRITE path: the return value becomes effectiveOwner for every
  // newly created epic. Neither project can reach it — normalizeProjectName()
  // has no alias for either and PROJECT_PREFIX no key — so both branches were
  // unreachable AND named agents that do not exist. Falling through to
  // 'todero-sme' is what already happened in practice.
  // TOD-2448: this returned 'infra-sme' or 'todero-sme' — BOTH undeclared by
  // every AGENTS.md in this repo. So an epic's owner and assignee were routed
  // to an agent that does not exist, on every project. Epics route to `po`, the
  // Product Owner, which is declared and whose queue prompt already decomposes
  // epics into features. The per-project branch is gone rather than repointed:
  // it existed only to pick between two fabrications.
  function hubSmeForProject(_proj: string): string {
    return 'po'
  }

  // Owner is always determined by issue type — callers cannot override.
  // Same rule as status (always backlog on creation): structural field, not user input.
  const issueTypeForOwner = type ?? 'task'
  let effectiveOwner: string
  if (issueTypeForOwner === 'task' || issueTypeForOwner === 'bug') effectiveOwner = 'builder'
  else if (issueTypeForOwner === 'feature') effectiveOwner = 'po'
  else if (issueTypeForOwner === 'epic') effectiveOwner = hubSmeForProject(normalizedProject)
  else if (issueTypeForOwner === 'ops') effectiveOwner = 'ops'
  else if (issueTypeForOwner === 'research') effectiveOwner = 'scout'
  else effectiveOwner = 'builder'
  void owner // caller value ignored

  // All issues must arrive at backlog — no skipping the intake queue.
  // Callers cannot override this; status is ignored on creation.
  const effectiveStatus = 'backlog'
  void status // suppress unused-var lint

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
      effectiveAssignee = hubSmeForProject(normalizedProject); routingNote = `[auto-routed to ${hubSmeForProject(normalizedProject)}: type=epic]`
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
    const { data: existingByTitle } = await getSupabase()
      .from('issues')
      .select('id, task_key, status')
      .eq('title', title)
      .not('status', 'in', ['completed', 'closed', 'cancelled'])
      .maybeSingle()
    if (existingByTitle) {
      return NextResponse.json(
        { error: `Duplicate review issue blocked: "${title}" already exists as ${existingByTitle.task_key} (${existingByTitle.status}). Update the existing issue instead.` },
        { status: 409 }
      )
    }
    if (parent_id && type === 'review') {
      const { data: existingByParent } = await getSupabase()
        .from('issues')
        .select('id, task_key, status')
        .eq('parent_id', parent_id)
        .eq('type', 'review')
        .not('status', 'in', ['completed', 'closed', 'cancelled'])
        .maybeSingle()
      if (existingByParent) {
        return NextResponse.json(
          { error: `Duplicate review issue blocked: parent ${parent_id} already has a review issue (${existingByParent.task_key}). Update the existing one instead.` },
          { status: 409 }
        )
      }
    }
  }

  // effectiveStatus is always 'backlog' — all issues start in intake queue
  const finalStatus = effectiveStatus

  // ── Duplicate child task guards (TOD-1496) ───────────────────────────────
  // Prevent PO from creating near-identical child tasks on repeated runs.
  if (parent_id && type === 'task') {
    // Guard 1: hard cap — features should not have more than 20 open child tasks.
    const { count: childCount } = await getSupabase()
      .from('issues')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', parent_id)
      .not('status', 'in', ['closed', 'wrapped', 'completed'])
    if ((childCount ?? 0) >= 20) {
      return NextResponse.json(
        { error: `Child task cap reached: parent already has ${childCount} open child tasks (max 20). Close or complete existing tasks before adding more.` },
        { status: 409 }
      )
    }

    // Guard 2: near-duplicate title — first 50 chars match an existing open child.
    if (title && title.length >= 10) {
      const { data: siblings } = await getSupabase()
        .from('issues')
        .select('id, task_key, title, status')
        .eq('parent_id', parent_id)
        .not('status', 'in', ['closed', 'wrapped', 'completed'])
      const prefix = title.slice(0, 50).toLowerCase()
      const nearDupe = (siblings ?? []).find(
        s => s.title && s.title.slice(0, 50).toLowerCase() === prefix
      )
      if (nearDupe) {
        return NextResponse.json(
          { error: `Near-duplicate child task blocked: "${nearDupe.task_key}" (${nearDupe.status}) already covers "${title.slice(0, 60)}". Update the existing task instead.` },
          { status: 409 }
        )
      }
    }
  }

  const generatedIdentity = await prepareIssueIdentity(normalizedProject)

  // Resolve business_id from project → business mapping
  let effectiveBusinessId = body.business_id ?? null
  if (!effectiveBusinessId && normalizedProject) {
    const { data: proj } = await getSupabase()
      .from('projects')
      .select('business_id')
      .eq('name', normalizedProject)
      .maybeSingle()
    if (proj?.business_id) effectiveBusinessId = proj.business_id
  }

  const { data, error } = await getSupabase()
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
  // Round-4: awaited so a failed write (e.g. activity_events missing on this
  // install) is known before the response is built, not discarded.
  const postActivityOutcomes: Array<{ ok: boolean; error: string | null }> = []
  if (data) {
    const actor = (body.transitioned_by ?? body.assignee ?? null) as string | null
    postActivityOutcomes.push(await recordActivityEvent(data.id, data.task_key, 'issue_created', actor, {
      status: data.status,
      assignee: data.assignee,
      project: data.project,
      type: data.type,
      priority: data.priority,
    }))
  }

  // Post to #0-created on every new issue. DO NOT REMOVE.
  if (data) {
    try {
      const typeEmoji = TYPE_EMOJI[(data.type as string) ?? 'task'] ?? '📋'
      const key = (data.task_key as string) ?? '?'
      const prio = data.priority as string | undefined
      const prioEmoji = prio ? `P${PRIORITY_EMOJI[prio] ?? prio}` : null
      const sev = data.severity as string | undefined
      const sevEmoji = sev ? `S${SEVERITY_EMOJI[sev] ?? sev}` : null
      const creator = (body.transitioned_by as string) ?? (body.assignee as string) ?? 'unknown'
      let parentKey: string | null = null
      if (data.parent_id) {
        const { data: par } = await getSupabase().from('issues').select('task_key').eq('id', data.parent_id as string).maybeSingle()
        parentKey = par?.task_key ?? null
      }
      const meta: string[] = [`Creator: ${creator}`]
      if (prioEmoji) meta.push(prioEmoji)
      if (sevEmoji) meta.push(sevEmoji)
      if (parentKey) meta.push(`Parent: ${parentKey}`)
      postDiscord(CREATED_CHANNEL, `${typeEmoji} **${key}** — ${data.title ?? ''}\n↳ ${meta.join(' · ')}`)
    } catch (e) {
      console.warn('[discord-created] notify failed:', e)
    }
  }


  // Q4: If a child issue is created under a feature in feature_review → revert to underway.
  // Means the feature has open work remaining; PO or agent created a gap-filling child.
  const postCascadeFailures: string[] = []
  if (data && parent_id) {
    const { data: parentFeature } = await getSupabase()
      .from('issues')
      .select('id, type, status')
      .eq('id', parent_id as string)
      .maybeSingle()
    if (parentFeature?.type === 'feature' && parentFeature.status === 'feature_review') {
      const { error: revertError } = await getSupabase()
        .from('issues')
        .update({ status: 'underway', updated_at: new Date().toISOString() })
        .eq('id', parent_id as string)
      if (revertError) {
        postCascadeFailures.push(`feature ${parent_id} NOT reverted feature_review→underway: ${revertError.message}`)
      } else {
        console.log(`[auto-revert] Feature ${parent_id} reverted feature_review→underway (new child ${data.task_key} created)`)
      }
    }
  }


  // Warn if bug is created without environment field
  const responseData = withIssueStatusCategory(data)
  issuesCache.clear()

  const postActivityWarning = activityEventWarning(postActivityOutcomes)
  const extraFields: Record<string, unknown> = {}
  if (postActivityWarning) extraFields._warning = postActivityWarning
  if (postCascadeFailures.length > 0) extraFields.cascade_failures = postCascadeFailures

  if ((type ?? 'task') === 'bug' && !body.environment) {
    return NextResponse.json({
      ...responseData,
      ...extraFields,
      _warning: [extraFields._warning, 'Bug created without "environment" field. Set it before moving to refined (required for backlog→refined).']
        .filter(Boolean).join(' | '),
    })
  }

  return NextResponse.json(
    Object.keys(extraFields).length > 0 ? { ...responseData, ...extraFields } : responseData,
  )
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  // TOD-2445: the review lifecycle's derived test verdict, held in a LOCAL
  // rather than written to the row. `issues` has tester_status, designer_status,
  // deployer_status and test_tier — and no `test_status`. Three sites wrote it,
  // so every PATCH into or out of code_review answered HTTP 500 `no such column:
  // test_status` and the review lifecycle could not complete in either
  // direction. lib/pipeline-stages.ts and PipelineTab both documented that the
  // column does not exist and fixed the READ side; nobody owned the write side.
  let derivedTestStatus: string | undefined
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  // Round-4 fix: every cascade write below used to be `void (async () => {…})()`
  // or an unchecked `.update()` — fired, never awaited, error never read. This
  // route reported a clean 200 while, e.g., the very unblock a loop_breaker
  // approval depends on silently failed. Every cascade site now awaits its
  // write, checks `error`, and — on failure — pushes a human-readable line
  // here instead of logging the success message. Surfaced as `cascade_failures`
  // on the response so the operator sees "TOD-x was NOT unblocked" rather than
  // inferring it from a missing side effect.
  const cascadeFailures: string[] = []

  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'PATCH', '/api/issues')
    if (!perm.allowed) {
      return NextResponse.json(perm.body, { status: perm.status })
    }
  }

  const body = await req.json()
  // business_id is extracted for hub-scoped query validation, not written back to the issue
  const { id: rawId, task_key, transitioned_by: _transitionedBy, business_id: scopeBusinessId, ...fields } = body
  // The browser has no agent id to send. When the body omits one, attribute the
  // transition to the signed-in human instead of leaving it unset — otherwise the
  // workflow guard below rejects every Board drag the owner makes. Agent callers
  // carry no session cookie, so they still have to send their own identity.
  const transitionedBy = (_transitionedBy as string | undefined) ?? resolveSessionActor(req)

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
    // Rule 2: backlog resets always assign to PO (bypasses post_functions early return)
    if (!fields.assignee) fields.assignee = 'po'
    let resetQ = createAdminClient()
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
    if (hubScope) resetQ = resetQ.eq('business_id', hubScope.businessId)
    const { data: resetData, error: resetErr } = await resetQ.select().single()
    if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 500 })
    // TOD-818: record status_changed for backlog reset
    let resetActivityWarning: string | null = null
    if (resetData && before) {
      const outcome = await recordActivityEvent(
        resetData.id as string,
        (resetData.task_key ?? before.task_key ?? null) as string | null,
        'status_changed',
        transitionedBy ?? null,
        { old_status: before.status, new_status: 'backlog' }
      )
      resetActivityWarning = activityEventWarning([outcome])
    }
    return NextResponse.json(
      resetActivityWarning ? { ...resetData, _warning: resetActivityWarning } : resetData,
    )
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

  // Rule 3: owner required before moving to defined
  if (fields.status === 'defined' && before?.status !== 'defined') {
    const effectiveOwner = ((fields.owner ?? before?.owner) as string | undefined | null)?.trim() ?? ''
    if (!effectiveOwner) {
      return NextResponse.json(
        { error: 'owner is required before moving to defined. Set the owner field to the agent or person responsible for delivery.' },
        { status: 400 }
      )
    }
  }

  // description + test_tier required before moving to refined
  if (fields.status === 'refined' && before?.status !== 'refined') {
    const effectiveDesc = ((fields.description ?? before?.description) as string | undefined | null)?.trim() ?? ''
    if (!effectiveDesc) {
      return NextResponse.json(
        { error: 'description is required before moving to refined. Add a clear description of what needs to be built/done and retry.' },
        { status: 400 }
      )
    }
    const effectiveType = (fields.type ?? before?.type ?? 'task') as string
    if (['task', 'bug', 'ops'].includes(effectiveType)) {
      const effectiveTier = (fields.test_tier ?? before?.test_tier ?? '') as string
      if (!effectiveTier) {
        return NextResponse.json(
          { error: 'test_tier is required for task/bug/ops before moving to refined. Set it to smoke, integration, or e2e.' },
          { status: 400 }
        )
      }
    }
  }

  // TOD-604: acceptance_criteria required before moving to open
  if (fields.status === 'open' && before?.status !== 'open') {
    const effectiveAC = (fields.acceptance_criteria ?? before?.acceptance_criteria ?? '').trim()
    if (!effectiveAC) {
      return NextResponse.json(
        { error: 'acceptance_criteria is required before moving to open. Add it via PATCH and retry.' },
        { status: 400 }
      )
    }

    // TOD-1199: backlog-first policy — cap open issues at 10
    const { count: openCount, error: countErr } = await getSupabase()
      .from('issues')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open')
    if (!countErr && openCount !== null && openCount >= 10) {
      return NextResponse.json(
        { error: 'Backlog-first policy: cannot move issue to open when 10 or more issues are already open. Finish or backlog existing open issues first.', open_count: openCount },
        { status: 409 }
      )
    }

    // Auto-reassign: if a reviewer agent (tester, designer, auditor, deployer, po)
    // is rejecting back to open, reset the assignee to the correct implementing agent.
    // This prevents issues from being permanently stuck when reviewers don't set assignee.
    const REVIEWER_ONLY_AGENTS = ['tester', 'designer', 'auditor', 'deployer', 'po']
    const currentAssignee = fields.assignee ?? before?.assignee
    if (currentAssignee && REVIEWER_ONLY_AGENTS.includes(currentAssignee) && !fields.assignee) {
      const issueType = (fields.type ?? before?.type ?? 'task') as string
      // no-invented-projects-sweep: this chain opened with
      //   if (issueProject === 'Kemuni')       fields.assignee = 'kemuni-sme'
      //   else if (issueProject === 'Vespera') fields.assignee = 'vespera-sme'
      // Another WRITE path — the auto-reassign that fires when a reviewer bounces
      // an issue back to open. Had a legacy row carrying project 'Kemuni' or
      // 'Vespera' passed through here, it would have been PATCHed to an assignee
      // that does not exist and then stalled with no agent able to claim it.
      // Such rows now fall to the 'builder' default like any other project.
      // The `issueProject` binding that fed those two tests went with them:
      // nothing else in this block read it.
      if (issueType === 'ops') {
        fields.assignee = 'ops'
      } else {
        fields.assignee = 'builder'
      }
    }
  }

  // resolution_type + implementation_notes required before submitting work for review.
  // The assignee sets these when they PATCH to code_review or product_review —
  // it tells reviewers what kind of change was made before they even look at the diff.
  if ((fields.status === 'code_review' || fields.status === 'product_review') && before?.status !== fields.status) {
    const effectiveResType = fields.resolution_type ?? before?.resolution_type
    if (!effectiveResType) {
      return NextResponse.json(
        { error: `resolution_type is required before moving to ${fields.status}. Set it to what was done (e.g. code_change, config_change, research_completed). Allowed: ${VALID_RESOLUTION_TYPES.join(', ')}` },
        { status: 422 }
      )
    }
    const effectiveImplNotes = ((fields.implementation_notes ?? before?.implementation_notes) as string | null | undefined)
    if (!effectiveImplNotes || String(effectiveImplNotes).trim().length < 10) {
      return NextResponse.json(
        { error: `implementation_notes is required before moving to ${fields.status}. Describe what was built/researched/changed (≥10 chars).` },
        { status: 422 }
      )
    }
  }

  // resolution_type required to close any issue from any status.
  // The normal pipeline path auto-sets it at approved (code_review dual-pass),
  // so this only catches gaps: direct closures, feature_review→closed, wrapped→closed.
  if (fields.status === 'closed' && before?.status !== 'closed') {
    const effectiveResType = fields.resolution_type ?? before?.resolution_type
    if (!effectiveResType) {
      return NextResponse.json(
        { error: `resolution_type is required to close an issue. Allowed: ${VALID_RESOLUTION_TYPES.join(', ')}` },
        { status: 422 }
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

    // started_at + worked_by: set on ANY transition to in_progress (not just from open).
    // Previously only fired on open→in_progress, allowing null started_at if coming from
    // another status — those ghost claims counted against WIP but were never cleared
    // by the watchdog (which requires started_at IS NOT NULL for its stale check).
    if (fields.status === 'in_progress') {
      if (!before?.started_at && !fields.started_at) fields.started_at = now
      const effectiveAssignee = fields.assignee ?? before?.assignee
      if (effectiveAssignee && !fields.worked_by && !before?.worked_by) fields.worked_by = effectiveAssignee
    }
    if (['backlog', 'refined', 'open'].includes(fields.status as string)) {
      if (before?.started_at) fields.started_at = null
      if (before?.worked_by) fields.worked_by = null
    }

    if (fields.status === 'code_review') fields.submitted_at = now
    if (fields.status === 'code_review') {
      // On re-entry to code_review (after a rejection cycle), reset both reviewer lanes to
      // pending so reviewers can re-evaluate the fix. Without this, stale 'failed' statuses
      // from the prior rejection prevent reviewers from picking the issue up again — their
      // queue filter is tester_status=eq.pending / designer_status=eq.pending.
      if (before?.status !== 'code_review') {
        if (fields.tester_status === undefined) fields.tester_status = 'pending'
        if (fields.designer_status === undefined) fields.designer_status = 'pending'
      }
      if (fields.tester_notes === undefined && before?.tester_notes == null) fields.tester_notes = null
      if (fields.designer_notes === undefined && before?.designer_notes == null) fields.designer_notes = null
      if (fields.tested_by === undefined && before?.tested_by == null) fields.tested_by = null
      if (fields.designed_by === undefined && before?.designed_by == null) fields.designed_by = null
      if (fields.tester_reviewed_at === undefined && before?.tester_reviewed_at == null) fields.tester_reviewed_at = null
      if (fields.designer_reviewed_at === undefined && before?.designer_reviewed_at == null) fields.designer_reviewed_at = null
    }

    if (fields.status === 'completed' || fields.status === 'wrapped') {
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

    // Clear resolution_type when sent back to open from a forward status —
    // the issue may be resolved differently when re-picked up.
    if (fields.status === 'open' && before?.status) {
      const FORWARD_STATUSES = ['in_progress', 'code_review', 'product_review', 'approved', 'completed']
      if (FORWARD_STATUSES.includes(before.status as string)) {
        fields.resolution_type = null
      }
    }
  }

  const transitioningIntoCodeReview = fields.status === 'code_review' && before?.status !== 'code_review'
  const issueTypeForGates = (fields.type ?? before?.type ?? 'task') as string

  // TOD-XXX (2026-04-10 validators requested by Michael):
  // V1 — commit_sha required before in_progress → code_review
  // V2 — regression_test required in the same transition
  // TOD-1205: enforce for task, bug, and ops; feature/epic skip these gates
  if (transitioningIntoCodeReview && ['task', 'bug', 'ops'].includes(issueTypeForGates)) {
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

  // TOD-1203: When a feature transitions to 'defined' and has no parent epic,
  // first search for a relevant existing epic in the same project, then create one if none found.
  const transitioningFeatureToDefined =
    fields.status === 'defined' &&
    before?.status !== 'defined' &&
    (before?.type === 'feature' || fields.type === 'feature')
  if (transitioningFeatureToDefined) {
    const currentParentId = (fields.parent_id ?? before?.parent_id) as string | null | undefined
    if (!currentParentId) {
      const featureTitle = (fields.title ?? before?.title ?? 'Untitled Feature') as string
      const featureProject = (fields.project ?? before?.project ?? 'Mission Control') as string

      // Search for an existing epic in the same project that's in draft/active/backlog
      const { data: existingEpics } = await getSupabase()
        .from('issues')
        .select('id, task_key, title')
        .eq('type', 'epic')
        .eq('project', featureProject)
        .in('status', ['draft', 'active', 'backlog'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingEpics) {
        fields.parent_id = existingEpics.id
        console.log(`[TOD-1203] linked feature to existing epic ${existingEpics.task_key} ("${existingEpics.title}")`)
      } else {
        // No existing epic — create one
        const epicTitle = `Epic: ${featureTitle}`
        const epicIdentity = await prepareIssueIdentity(featureProject)
        const epicDataToInsert = {
          title: epicTitle,
          description: `Auto-created epic for feature: ${featureTitle}`,
          type: 'epic' as const,
          status: 'draft',
          priority: (fields.priority ?? before?.priority ?? 'medium') as string,
          project: featureProject,
          assignee: 'main',
          owner: 'main',
          acceptance_criteria: `Parent epic for feature "${featureTitle}". Tracks overall delivery.`,
          ...epicIdentity,
          ...(before?.business_id ? { business_id: before.business_id } : {}),
        }
        const { data: newEpic, error: epicErr } = await createAdminClient()
          .from('issues')
          .insert(epicDataToInsert)
          .select('id, task_key')
          .single()
        if (epicErr || !newEpic) {
          console.error(`[TOD-1203] failed to auto-create epic for feature:`, epicErr?.message)
          cascadeFailures.push(`auto-epic for feature "${featureTitle}" NOT created: ${epicErr?.message ?? 'unknown error'}`)
        } else {
          fields.parent_id = newEpic.id
          console.log(`[TOD-1203] auto-created epic ${newEpic.task_key} as parent for feature transitioning to defined`)
        }
      }
    }
  }

  // V4 — closing_notes required for released/completed → closed, and only auditor
  const transitioningToClosed =
    fields.status === 'closed' &&
    (before?.status === 'released' || before?.status === 'completed' || before?.status === 'wrapped')
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
      // TOD-2445: `test_status` is NOT a column on `issues` — 57 columns, none
      // of them this one. Writing it made every PATCH into or out of
      // `code_review` answer HTTP 500 `no such column: test_status`, so the
      // whole review lifecycle was uncompletable in both directions. The
      // 42703 retry at the bottom of this handler strips 26 columns and this
      // was not among them, so the retry failed identically.
      //
      // The real columns are `tester_status` and `designer_status`, which
      // computeDualReviewState already reads and which this handler already
      // sets. The derived value is kept in a LOCAL, so the branch logic below
      // is unchanged and nothing is persisted that the table cannot hold.
      derivedTestStatus = 'failed'
        fields.rejection_count = (before?.rejection_count ?? 0) + 1
        fields.last_rejected_at = new Date().toISOString()
        const notes = aggregateReviewerNotes(mergedReviewState)
        if (notes) fields.last_rejection_reason = notes
      } else {
        derivedTestStatus = dual.overallTestStatus

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

  // Reset deployer_status when issue leaves approved — either rejected back to open
  // (needs re-rebase) or promoted to released (done; field no longer meaningful).
  if (fields.status && fields.status !== before?.status && before?.status === 'approved') {
    fields.deployer_status = null
  }

  // Also reset deployer_status when builder resubmits (in_progress → code_review/product_review).
  // Ensures deployer re-validates the branch even if it was previously marked ready on an older commit.
  if (fields.status && fields.status !== before?.status && before?.status === 'in_progress' &&
      (fields.status === 'code_review' || fields.status === 'product_review')) {
    fields.deployer_status = null
  }

  // Auto-clear is_blocked + blocked_by when an issue transitions to a new status —
  // BUT only when the transition is performed by an authorized human/orchestrator.
  // Agents (builder, tester, etc.) do NOT get to clear the block — only po, main,
  // michael, or kaos can deliberately unblock an issue.
  const authorizedUnblockers = ['po', 'main', 'michael', 'kaos']
  if (
    fields.status && fields.status !== before?.status &&
    authorizedUnblockers.includes(transitionedBy ?? '')
  ) {
    if (before?.is_blocked) {
      fields.is_blocked = false
      console.log(`[unblock] ${before?.task_key} is_blocked cleared on transition ${before?.status}→${fields.status} by ${transitionedBy}`)
    }
    if (before?.blocked_by) {
      fields.blocked_by = null
      console.log(`[unblock] ${before?.task_key} blocked_by cleared on transition ${before?.status}→${fields.status} by ${transitionedBy}`)
    }
  }

  // TOD-2445: reads the real column. `before?.test_status` was always undefined
  // because the column does not exist, so this comparison could never be false
  // for a failure — the counter incremented on every failing PATCH.
  const isNewFailure = derivedTestStatus === 'failed' && before?.tester_status !== 'failed'
  if (isNewFailure) {
    fields.fail_count = (before?.fail_count ?? 0) + 1
    if (fields.fail_count >= 3) {
      fields.is_blocked = true
      fields.assignee = 'michael'  // escalate to human — michael is the canonical human identity
    }
  }

  // TOD-XXX (2026-04-10): 3-strike loop breaker — auto-block on 3+ rejections.
  // rejection_count is incremented above when dual-review fails; set is_blocked so
  // the Board UI shows the lock icon and the Inbox can prompt for human review.
  // rejection_count is NEVER reset — it persists as an audit trail for retro analysis.
  const newRejectionCount = (fields.rejection_count as number | undefined) ?? before?.rejection_count ?? 0
  if (newRejectionCount >= 3 && !before?.is_blocked) {
    fields.is_blocked = true
    // Sentinel distinguishes rejection-loop blocks from dependency blocks.
    // run-agent and the main triage agent use this to route the issue correctly.
    fields.blocked_by = 'system:rejection_loop'
  }

  // When is_blocked becomes true, post to Discord #alerts and kick main (KAOS) to triage.
  // main IS a spawnable queue agent — it picks up all is_blocked=true issues.
  const becomingBlocked = fields.is_blocked === true && !before?.is_blocked
  if (becomingBlocked) {
    const blockedIssue = { ...before, ...fields }
    const key = (blockedIssue.task_key ?? '?') as string
    const title = (blockedIssue.title ?? '') as string
    const currentStatus = (blockedIssue.status ?? before?.status ?? '?') as string
    const blockedBy = (blockedIssue.blocked_by ?? before?.blocked_by ?? null) as string | null
    const reason = blockedBy === 'system:rejection_loop'
      ? `3+ review rejections (rejection_count=${newRejectionCount}) — main agent will triage`
      : blockedBy
        ? `blocked_by dependency: ${blockedBy}`
        : 'manually blocked'
    postDiscord('1485333335868834063',
      `🔴 **Blocked Issue — Needs KAOS Investigation**\n` +
      `**[${key}]** ${title}\n` +
      `Status: ${currentStatus} · Reason: ${reason}\n` +
      `To unblock: PATCH \`{"task_key":"${key}","is_blocked":false}\` once resolved.\n` +
      `<@409194957098713088> please investigate.`)
    console.log(`[blocked] ${key} blocked (${reason}) — posted to #alerts`)
    // Kick main (KAOS) immediately — don't wait for next watchdog tick
    void fetch('http://localhost:3000/api/run-agent?agent=main', { method: 'POST' }).catch(() => {})
  }

  // owner is immutable after creation — always strip it from PATCH payloads
  if (fields.owner !== undefined) {
    delete fields.owner
  }

  let updateQ = createAdminClient()
    .from('issues')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (hubScope) updateQ = updateQ.eq('business_id', hubScope.businessId)
  let { data, error } = await updateQ.select().single()

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
    let retryQ = createAdminClient()
      .from('issues')
      .update({ ...safeFields, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (hubScope) retryQ = retryQ.eq('business_id', hubScope.businessId)
    const retry = await retryQ.select().single()
    data = retry.data
    error = retry.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (fields.status && before?.status && fields.status !== before.status) {
    const issueType = (fields.type ?? before?.type ?? 'task') as string
    const toStatus = fields.status as string
    const WORKFLOW_TYPES = ['task', 'bug', 'feature', 'epic', 'ops', 'research']

    if (WORKFLOW_TYPES.includes(issueType) && data) {
      const { data: transition } = await getSupabase()
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
          let postQ = createAdminClient()
            .from('issues')
            .update({ ...postFields, updated_at: new Date().toISOString() })
            .eq('id', id)
          if (hubScope) postQ = postQ.eq('business_id', hubScope.businessId)
          const { data: postData } = await postQ.select().single()
          if (postData) data = postData
        }
      }
    }
  }

  const resolvedType = fields.resolution_type ?? data?.resolution_type
  const issueType = (fields.type ?? before?.type ?? 'task') as string
  const WORKFLOW_TYPES_NOTIFY = ['task', 'bug', 'feature', 'epic', 'ops', 'research']
  if (!WORKFLOW_TYPES_NOTIFY.includes(issueType) && (fields.status === 'approved' || fields.status === 'completed' || fields.status === 'wrapped' || fields.status === 'closed') && data) {
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

  // Kick main when a new rejection-loop or manual block appears
  if (fields.is_blocked === true && !before?.is_blocked) {
    selfChainOnBlocked(fields.is_blocked, fields.blocked_by as string | null | undefined)
  }

  // ── Close agent_runs on status change ──
  // When an issue status changes, any running agent_run for this task is done.
  // Round-4: was `void (async () => {…})()` — fired and forgotten. Now awaited
  // and its error checked, so a failed close is reported rather than leaving a
  // phantom "running" agent_run nobody knows failed to close.
  if (fields.status && fields.status !== before?.status && id) {
    try {
      const { error: closeRunError } = await createAdminClient()
        .from('agent_runs')
        .update({ status: 'completed', finished_at: new Date().toISOString() })
        .eq('task_id', id as string)
        .eq('status', 'running')
      if (closeRunError) {
        cascadeFailures.push(`agent_runs for ${before?.task_key ?? id} NOT closed: ${closeRunError.message}`)
      }
    } catch (err) {
      cascadeFailures.push(`agent_runs for ${before?.task_key ?? id} NOT closed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Downstream unblock: clear is_blocked on issues waiting for this one ──
  // When an issue reaches a terminal/completion status, any issue with blocked_by=this.id
  // is no longer blocked. Covers: closed, released, approved, completed.
  // Round-4: was `void (async () => {…})()` with the inner `.update()`'s error
  // never read — the exact class of defect (agent_memory upsert whose error was
  // discarded) the loop_breaker_pause fix in app/api/inbox/route.ts addressed,
  // left standing here at the MC API itself.
  const UNBLOCKING_STATUSES = new Set(['closed', 'released', 'approved', 'completed'])
  if (fields.status && UNBLOCKING_STATUSES.has(fields.status as string) && id) {
    try {
      const { data: blockedDeps, error: findBlockedError } = await createAdminClient()
        .from('issues')
        .select('id, task_key')
        .eq('blocked_by', id as string)
        .eq('is_blocked', true)
      if (findBlockedError) {
        cascadeFailures.push(`downstream unblock for ${before?.task_key ?? id} NOT attempted: ${findBlockedError.message}`)
      } else if (blockedDeps && blockedDeps.length > 0) {
        const { error: unblockError } = await createAdminClient()
          .from('issues')
          .update({ is_blocked: false, blocked_by: null, updated_at: new Date().toISOString() })
          .eq('blocked_by', id as string)
        const affected = blockedDeps.map(i => i.task_key).join(', ')
        if (unblockError) {
          cascadeFailures.push(`${affected} NOT unblocked (blocked_by ${before?.task_key ?? id}): ${unblockError.message}`)
        } else {
          console.log(`[unblock-downstream] ${before?.task_key ?? id} → ${fields.status}: unblocked ${affected}`)
        }
      }
    } catch (err) {
      cascadeFailures.push(`downstream unblock for ${before?.task_key ?? id} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Auto-promote feature from defined→underway when ANY child moves to open or beyond.
  const ACTIVE_CHILD_STATUSES = ['open', 'in_progress', 'code_review', 'product_review', 'approved', 'released']
  if (fields.status && data?.parent_id && ACTIVE_CHILD_STATUSES.includes(fields.status as string)) {
    const { data: parentFeature } = await getSupabase()
      .from('issues')
      .select('id, type, status')
      .eq('id', data.parent_id)
      .maybeSingle()
    if (parentFeature?.type === 'feature' && parentFeature.status === 'defined') {
      const { error: promoteError } = await getSupabase()
        .from('issues')
        .update({ status: 'underway', updated_at: new Date().toISOString() })
        .eq('id', data.parent_id)
      if (promoteError) {
        cascadeFailures.push(`feature ${parentFeature.id} NOT promoted defined→underway: ${promoteError.message}`)
      } else {
        console.log(`[auto-promote] Feature ${parentFeature.id} promoted defined→underway (child moved to ${fields.status})`)
      }
    }
  }

  // Auto-promote feature from underway→feature_review when ALL children are closed.
  // Only 'closed' counts — 'released' still needs auditor, 'cancelled' is not a valid status.
  // This triggers PO to confirm the feature is done (PO then closes or reverts to underway).
  if (fields.status === 'closed' && data?.parent_id) {
    const { data: parentFeature } = await getSupabase()
      .from('issues')
      .select('id, type, status')
      .eq('id', data.parent_id)
      .maybeSingle()
    if (parentFeature?.type === 'feature' && parentFeature.status === 'underway') {
      const { data: siblings } = await getSupabase()
        .from('issues')
        .select('id, status')
        .eq('parent_id', data.parent_id)
      const allClosed = siblings && siblings.length > 0 &&
        siblings.every(c => c.status === 'closed')
      if (allClosed) {
        const { error: promoteError } = await getSupabase()
          .from('issues')
          .update({ status: 'feature_review', updated_at: new Date().toISOString() })
          .eq('id', data.parent_id)
        if (promoteError) {
          cascadeFailures.push(`feature ${parentFeature.id} NOT promoted underway→feature_review: ${promoteError.message}`)
        } else {
          console.log(`[auto-promote] Feature ${parentFeature.id} promoted underway→feature_review (all children closed)`)
          // selfChain kicks PO to confirm feature completion
          selfChainOnStatus('feature_review')
        }
      }
    }
  }

  // Auto-revert feature from underway→defined when ALL child issues are in backlog/refined.
  // This means no child is actively being worked on, so the feature is no longer "underway".
  if (fields.status && data?.parent_id && ['backlog', 'refined'].includes(fields.status as string)) {
    const { data: parentFeature } = await getSupabase()
      .from('issues')
      .select('id, type, status')
      .eq('id', data.parent_id)
      .maybeSingle()
    if (parentFeature?.type === 'feature' && parentFeature.status === 'underway') {
      const { data: siblings } = await getSupabase()
        .from('issues')
        .select('id, status')
        .eq('parent_id', data.parent_id)
      const allIdle = siblings && siblings.length > 0 &&
        siblings.every(c => ['backlog', 'refined', 'defined'].includes(c.status as string))
      if (allIdle) {
        const { error: revertError } = await getSupabase()
          .from('issues')
          .update({ status: 'defined', updated_at: new Date().toISOString() })
          .eq('id', data.parent_id)
        if (revertError) {
          cascadeFailures.push(`feature ${parentFeature.id} NOT reverted underway→defined: ${revertError.message}`)
        } else {
          console.log(`[auto-revert] Feature ${parentFeature.id} reverted underway→defined (all children idle)`)
        }
      }
    }
  }

  // PR notification handled by pr-window.py (1 consolidated message per window).
  // Per-issue notifyPRReview removed to avoid duplicate Discord messages.


  if (isNewFailure && data) {
    notifyTestFailure(data)
    if ((data.fail_count ?? 0) >= 3) notifyEscalation(data)
    // TOD-766: loop breaker — track consecutive failures at the agent level
    const failingAgent = (before?.assignee ?? data.assignee) as string | undefined
    if (failingAgent) {
      recordAgentFailure(failingAgent, id as string, (before?.title ?? data.title) as string | undefined)
        .catch(err => console.error(`[issues] recordAgentFailure(${failingAgent}) failed:`, err))
    }
  }

  // TOD-766: reset consecutive failure count when a test passes
  const isNewPass = derivedTestStatus === 'passed' && before?.tester_status !== 'passed'
  if (isNewPass && data) {
    const passingAgent = (before?.assignee ?? data.assignee) as string | undefined
    if (passingAgent) {
      resetAgentFailures(passingAgent)
        .catch(err => console.error(`[issues] resetAgentFailures(${passingAgent}) failed:`, err))
    }
  }

  if (isCompletedIssueStatus(fields.status) && before?.assignee === 'ux' && before?.parent_id) {
    // Determine correct completion status for parent type
    const { data: uxParent } = await getSupabase().from('issues').select('type').eq('id', before.parent_id).maybeSingle()
    const parentCompletionStatus = uxParent?.type === 'epic' ? 'wrapped' : 'closed'
    let parentUpdateQ = createAdminClient()
      .from('issues')
      .update({ status: parentCompletionStatus, updated_at: new Date().toISOString() })
      .eq('id', before.parent_id)
    if (hubScope) parentUpdateQ = parentUpdateQ.eq('business_id', hubScope.businessId)
    const { data: parentData, error: parentUpdateError } = await parentUpdateQ.select().single()
    if (parentUpdateError) {
      cascadeFailures.push(`parent ${before.parent_id} NOT moved to ${parentCompletionStatus}: ${parentUpdateError.message}`)
    } else if (parentData) {
      notifyDiscord({ ...parentData, resolution_type: parentData.resolution_type ?? 'code_change' })
    }
  }

  if (isNewFailure && before?.assignee === 'ux' && before?.parent_id && data) {
    const uxNotes = (data.description ?? '').slice(0, 300)
    // Round-4: give the fix task a real task_key the same way POST does, and
    // check the insert's error instead of firing it blind — an un-checked
    // insert here means a failed UX review silently produces no fix task at
    // all, with nothing in the response to say so.
    const uxFixIdentity = await prepareIssueIdentity('Mission Control')
    const uxFixTaskData = {
      title: `UX Fix: ${before.title ?? data.title}`,
      description: `UX review failed. Fix the following:\n\n${uxNotes}`,
      project: 'Mission Control',
      type: 'task' as const,
      priority: 'high',
      assignee: 'builder',
      acceptance_criteria: 'Address all UX review feedback.',
      sprint: new Date().toISOString().split('T')[0],
      parent_id: before.parent_id,
      severity: 'S2',
      ...uxFixIdentity,
      ...(before?.business_id ? { business_id: before.business_id } : {}),
    }
    const { error: uxFixInsertError } = await createAdminClient().from('issues').insert(uxFixTaskData)
    if (uxFixInsertError) {
      cascadeFailures.push(`UX fix task for ${before?.task_key ?? data.task_key} NOT created: ${uxFixInsertError.message}`)
    }
  }

  if (isCompletedIssueStatus(fields.status) && data?.parent_id) {
    let parentFetchQ = createAdminClient()
      .from('issues')
      .select('id, type, status, task_key, title, project')
      .eq('id', data.parent_id)
    if (hubScope) parentFetchQ = parentFetchQ.eq('business_id', hubScope.businessId)
    const { data: parentIssue } = await parentFetchQ.single()
    if (parentIssue?.type === 'epic' && parentIssue.status !== 'wrapped') {
      let childrenQ = createAdminClient()
        .from('issues')
        .select('id, status')
        .eq('parent_id', data.parent_id)
      if (hubScope) childrenQ = childrenQ.eq('business_id', hubScope.businessId)
      const { data: children } = await childrenQ
      const allDone = children && children.length > 0 && children.every(c => isCompletedIssueStatus(c.status) || isTerminalIssueStatus(c.status))
      if (allDone) {
        let epicUpdateQ = createAdminClient()
          .from('issues')
          .update({ status: 'wrapped', updated_at: new Date().toISOString() })
          .eq('id', data.parent_id)
        if (hubScope) epicUpdateQ = epicUpdateQ.eq('business_id', hubScope.businessId)
        const { error: epicWrapError } = await epicUpdateQ
        if (epicWrapError) {
          cascadeFailures.push(`epic ${data.parent_id} NOT wrapped: ${epicWrapError.message}`)
        }
      }
    }
  }

  // ── TOD-1226 / TOD-1236: Watcher notifications on resolution ────────────────
  if (data && fields.status && fields.status !== before?.status &&
      (fields.status === 'completed' || fields.status === 'wrapped' || fields.status === 'closed')) {
    notifyWatchers({
      task_key: data.task_key as string | undefined,
      title: data.title as string | undefined,
      resolution_type: (fields.resolution_type ?? data.resolution_type) as string | undefined,
      implementation_notes: (fields.implementation_notes ?? data.implementation_notes) as string | undefined,
      closing_notes: (fields.closing_notes ?? data.closing_notes) as string | undefined,
      watchers: data.watchers as string[] | null | undefined,
    })
  }

  // ── TOD-631: In-app notifications on status transitions ──
  // Round-4: was fire-and-forget `.then(() => {})` — error never read.
  if (fields.status && before?.status && fields.status !== before.status && data) {
    const taskKey = data.task_key ?? before.task_key ?? ''
    const title = data.title ?? before.title ?? ''
    const actor = (fields.transitioned_by ?? data.transitioned_by ?? 'system') as string
    const { error: notifError } = await getSupabase().from('notifications').insert({
      type: 'status_change',
      title: `${taskKey} → ${fields.status}`,
      body: title,
      issue_key: taskKey,
      issue_id: data.id,
      actor,
    })
    if (notifError) {
      cascadeFailures.push(`in-app notification for ${taskKey} NOT recorded: ${notifError.message}`)
    }
  }

  // ── TOD-818: Activity event capture ──────────────────────────────────────────
  // Round-4: each recordActivityEvent() call is now awaited and its outcome
  // collected; a failure surfaces as `_warning` on the response instead of
  // being discarded by the old fire-and-forget insert.
  const patchActivityOutcomes: Array<{ ok: boolean; error: string | null }> = []
  if (data && before) {
    const issueId = data.id as string
    const issueKey = (data.task_key ?? before.task_key ?? null) as string | null
    const actor = transitionedBy ?? null

    // status_changed
    if (fields.status && before.status && fields.status !== before.status) {
      patchActivityOutcomes.push(await recordActivityEvent(issueId, issueKey, 'status_changed', actor, {
        old_status: before.status,
        new_status: fields.status,
      }))
    }

    // assignee_changed
    if (fields.assignee && before.assignee && fields.assignee !== before.assignee) {
      patchActivityOutcomes.push(await recordActivityEvent(issueId, issueKey, 'assignee_changed', actor, {
        old_assignee: before.assignee,
        new_assignee: fields.assignee,
      }))
    }

    // comment_added — treat non-empty implementation_notes changes as comments
    if (
      fields.implementation_notes &&
      fields.implementation_notes !== before.implementation_notes
    ) {
      patchActivityOutcomes.push(await recordActivityEvent(issueId, issueKey, 'comment_added', actor, {
        field: 'implementation_notes',
      }))
    }

    // reviewer_notes change
    if (
      fields.reviewer_notes &&
      fields.reviewer_notes !== before.reviewer_notes
    ) {
      patchActivityOutcomes.push(await recordActivityEvent(issueId, issueKey, 'comment_added', actor, {
        field: 'reviewer_notes',
      }))
    }
  }

  issuesCache.clear()

  const patchActivityWarning = activityEventWarning(patchActivityOutcomes)
  if (!data) {
    return NextResponse.json(data)
  }
  const patchResponse: Record<string, unknown> = withIssueStatusCategory(data)
  if (patchActivityWarning) patchResponse._warning = patchActivityWarning
  if (cascadeFailures.length > 0) patchResponse.cascade_failures = cascadeFailures
  return NextResponse.json(patchResponse)
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await getSupabase().from('issues').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
