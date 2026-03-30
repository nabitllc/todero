import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec as execAsync } from 'child_process'

// Item 4: Assignee → OpenClaw agent ID mapping for immediate activation
const ASSIGNEE_AGENT_MAP: Record<string, string | null> = {
  'tester': 'tester',
  'scout': 'scout',
  'ops': 'ops',
  'kemuni-sme': 'kemuni-sme',
  'vespera-sme': 'vespera-sme',
  'main': 'main',
  'KAOS': 'main',
  'builder': 'main',   // builder isn't a real OpenClaw agent yet — notify main
  'michael': null,     // human — skip
}

// Fire-and-forget: activate agent immediately on status transition
function activateAgentAsync(assignee: string, taskKey: string, title: string, status: string) {
  const agentId = ASSIGNEE_AGENT_MAP[assignee]
  if (!agentId) return
  const msg = status === 'in_review'
    ? `Issue ${taskKey} needs review: ${title}. Pick it up and review against AC + DoD.`
    : `Issue ${taskKey} is ready: ${title}. Pick it up and start work.`
  const cmd = `openclaw agent --agent ${agentId} --message ${JSON.stringify(msg)} 2>/dev/null`
  execAsync(cmd, { timeout: 30000 }, () => {}) // fire-and-forget
}

const DISCORD_CHANNEL = '1487584901678104698'
const PROJECT_EMOJI: Record<string, string> = {
  Vespera: '🖤', Kemuni: '🚀', 'Mission Control': '🧠', Infrastructure: '⚙️'
}

const RES_LABEL: Record<string, string> = {
  code_change: '🚢 shipped', config_change: '⚙️ config', by_design: '✏️ by design',
  wont_fix: '🚫 won\'t fix', canceled: '❌ canceled', duplicate: '🔁 duplicate',
  cannot_reproduce: '❓ cannot reproduce'
}

function notifyDiscord(issue: { task_key?: string; title?: string; project?: string; resolution_type?: string; assignee?: string; severity?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const res = RES_LABEL[issue.resolution_type ?? ''] ?? issue.resolution_type ?? 'done'
  const tier = issue.severity ? ` · ${issue.severity}` : ''
  const msg = `${emoji} **[${key}]** ${issue.title ?? ''} · ${res}${tier}`

  fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN ?? ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://openclaw.ai, 1.0)'
    },
    body: JSON.stringify({ content: msg })
  }).catch(err => console.error('[discord-notify]', err))
}

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

// MC-210: Project prefix map for task_key generation
const PROJECT_PREFIX: Record<string, string> = {
  'Mission Control': 'MC', Infrastructure: 'INF', Vespera: 'VES', Kemuni: 'KEM'
}

// MC-210: Atomic task_key generation — uses Postgres sequence (via RPC) with fallback
async function generateTaskKey(project: string): Promise<{ task_key: string; task_number: number }> {
  const prefix = PROJECT_PREFIX[project] ?? 'TASK'

  // Preferred path: Postgres sequence via RPC (atomic, no race)
  try {
    const { data: seqNum, error: rpcErr } = await supabase.rpc('next_task_number')
    if (!rpcErr && typeof seqNum === 'number') {
      return { task_key: `${prefix}-${seqNum}`, task_number: seqNum }
    }
  } catch { /* RPC not yet deployed — fall through */ }

  // Fallback: MAX(task_number) + 1 with retry on collision
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

    if (!existing) {
      return { task_key: key, task_number: nextNumber }
    }
  }

  // Last resort: timestamp-based to guarantee uniqueness
  const ts = Date.now() % 1000000
  return { task_key: `${prefix}-${ts}`, task_number: ts }
}

export async function GET() {
  const { data, error } = await supabase
    .from('issues')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { title, description, status, assignee, project, priority, type, due_date,
          acceptance_criteria, sprint, parent_id, severity, resolution_type,
          feature_branch, pr_url, task_key: _clientKey, task_number: _clientNum } = body

  // ── Enforcement: no issue without title + project + acceptance_criteria ──
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
    return NextResponse.json(
      { error: 'Feature requires: description' },
      { status: 422 }
    )
  }

  // ── Sprint required for non-backlog issues ──
  const effectiveStatus = status ?? 'open'
  if (effectiveStatus !== 'backlog' && !sprint?.trim()) {
    return NextResponse.json(
      { error: 'sprint is required for non-backlog issues. Assign a sprint date (YYYY-MM-DD) or set status to backlog.' },
      { status: 422 }
    )
  }

  // ── Auto-routing: assign issues when assignee is null or 'main' ──
  let effectiveAssignee = assignee
  let routingNote = ''
  if (!effectiveAssignee || effectiveAssignee === 'main' || effectiveAssignee === 'kaos') {
    const effectiveType = type ?? 'task'
    const titleLower = (title ?? '').toLowerCase()
    const descLower = (description ?? '').toLowerCase()

    if (titleLower.includes('manual') || titleLower.includes('blocked') || descLower.includes('requires michael')) {
      effectiveAssignee = 'michael'
      routingNote = '[auto-routed to michael: manual/blocked/requires michael]'
    } else if (titleLower.includes('research') || titleLower.includes('evaluate') || titleLower.includes('scout')) {
      effectiveAssignee = 'scout'
      routingNote = '[auto-routed to scout: research/evaluate/scout keyword]'
    } else if (effectiveType === 'ops') {
      effectiveAssignee = 'ops'
      routingNote = '[auto-routed to ops: type=ops]'
    } else if (effectiveType === 'task' || effectiveType === 'bug') {
      effectiveAssignee = 'builder'
      routingNote = `[auto-routed to builder: type=${effectiveType}]`
    } else if (effectiveType === 'feature' || effectiveType === 'epic') {
      if (project === 'Kemuni') {
        effectiveAssignee = 'kemuni-sme'
        routingNote = '[auto-routed to kemuni-sme: feature/epic + Kemuni]'
      } else if (project === 'Vespera') {
        effectiveAssignee = 'vespera-sme'
        routingNote = '[auto-routed to vespera-sme: feature/epic + Vespera]'
      } else {
        effectiveAssignee = 'builder'
        routingNote = `[auto-routed to builder: feature/epic + ${project}]`
      }
    } else {
      effectiveAssignee = 'builder'
      routingNote = '[auto-routed to builder: default fallback]'
    }
  }

  const effectiveDescription = routingNote
    ? (description ? `${description}\n\n${routingNote}` : routingNote)
    : description

  // ── Dedup guard: reject duplicate tester/reviewer issues ──
  // If a review/tester issue with same title OR same parent_id+type already exists
  // and is not done/cancelled, block creation to prevent runaway duplicates
  const isTesterIssue = (title ?? '').startsWith('🧪 Tester:') || (title ?? '').includes('Tester: Review')
  if (isTesterIssue || type === 'review') {
    // Check by exact title match
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
    // Check by parent_id+type
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

  // ── Default new issues to backlog if not explicitly set ──
  // Tester/review issues should never auto-open
  const finalStatus = isTesterIssue || type === 'review'
    ? (effectiveStatus === 'open' ? 'backlog' : effectiveStatus)
    : effectiveStatus

  // MC-210: Always generate task_key server-side to prevent race conditions
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
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

function notifyPRReview(issue: { task_key?: string; title?: string; project?: string; feature_branch?: string; pr_url?: string }) {
  const key = issue.task_key ?? '?'
  const msg = `🔀 **PR Ready for Review**\n**[${key}]** ${issue.title ?? ''}\nProject: ${issue.project ?? ''} · Branch: ${issue.feature_branch ?? ''}\nPR: ${issue.pr_url ?? ''}\n<@409194957098713088> ready to merge`

  fetch(`https://discord.com/api/v10/channels/1487826368170299592/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN ?? ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://openclaw.ai, 1.0)'
    },
    body: JSON.stringify({ content: msg })
  }).catch(err => console.error('[discord-pr-review]', err))
}

function notifyEscalation(issue: { task_key?: string; title?: string; project?: string; acceptance_criteria?: string; description?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const ac = (issue.acceptance_criteria ?? '').slice(0, 300)
  const desc = (issue.description ?? '').slice(0, 300)
  const msg = `🚨🚨 **ESCALATION: [${key}]** ${issue.title ?? ''}\n${emoji} Project: ${issue.project ?? ''}\n⚠️ **3 failed reviews — escalated to KAOS**\n📋 AC: ${ac}\n📝 Notes: ${desc}\n\n<@409194957098713088> manual investigation required.`

  fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN ?? ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://openclaw.ai, 1.0)'
    },
    body: JSON.stringify({ content: msg })
  }).catch(err => console.error('[discord-escalation]', err))
}

function notifyTestFailure(issue: { task_key?: string; title?: string; project?: string; description?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  // Extract failure notes from description (after "---" separator if present)
  const desc = issue.description ?? ''
  const failureSection = desc.includes('---') ? desc.split('---').pop()?.trim().slice(0, 300) : desc.slice(0, 300)
  const msg = `🚨 **Test Failed: [${key}]** ${issue.title ?? ''}\n${emoji} Project: ${issue.project ?? ''}\n📝 Tester notes: ${failureSection || 'No details provided'}\n\nBuilder: pick up fix on next loop tick.`

  fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN ?? ''}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://openclaw.ai, 1.0)'
    },
    body: JSON.stringify({ content: msg })
  }).catch(err => console.error('[discord-test-failure]', err))
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id: rawId, task_key, ...fields } = body

  // ── Resolve UUID: accept either id (UUID) or task_key (e.g. INF-254) ──
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

  // ── Fetch existing record for transition validation ──
  const { data: before } = await supabase
    .from('issues')
    .select('*')
    .eq('id', id)
    .single()

  // ── MC-314: Transition validation — enforce required fields per status change ──
  if (fields.status) {
    const merged = { ...before, ...fields }

    // Backlog constraint: reject if sprint is set
    if (fields.status === 'backlog' && (fields.sprint || (!('sprint' in fields) && before?.sprint))) {
      return NextResponse.json(
        { error: 'Cannot move to backlog: sprint must be null. Backlog issues cannot have a sprint assigned.' },
        { status: 400 }
      )
    }

    // To 'open': require priority, sprint, assignee, acceptance_criteria, severity, AND reviewer (set by PO/KAOS)
    if (fields.status === 'open') {
      const missing: string[] = []
      if (!merged.priority) missing.push('priority')
      if (!merged.sprint) missing.push('sprint')
      if (!merged.assignee) missing.push('assignee')
      if (!merged.acceptance_criteria) missing.push('acceptance_criteria')
      if (!merged.severity) {
        return NextResponse.json(
          { error: 'severity is required before moving to open. Set S0-S3 based on change risk.' },
          { status: 400 }
        )
      }
      if (!merged.reviewer) {
        return NextResponse.json(
          { error: 'reviewer is required before moving to open. Set the reviewer (e.g. tester, designer, po) during backlog grooming.' },
          { status: 400 }
        )
      }
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot move to open: missing required fields: ${missing.join(', ')}. All open issues need priority, sprint, assignee, and acceptance_criteria.` },
          { status: 400 }
        )
      }
    }

    // To 'in_review': require (feature_branch OR commit_sha OR pr_url), implementation_notes, AND regression_test
    // Fallback: accept implementation notes in description (for backward compat before DB migration)
    if (fields.status === 'in_review') {
      const hasImplNotes = merged.implementation_notes ||
        (merged.description && /IMPLEMENTATION/i.test(merged.description))
      if (!hasImplNotes) {
        return NextResponse.json(
          { error: 'Cannot move to in_review: implementation_notes is required. Builder must include handoff notes for the reviewer.' },
          { status: 400 }
        )
      }
      const hasRef = merged.feature_branch || merged.commit_sha || merged.pr_url
      if (!hasRef) {
        return NextResponse.json(
          { error: 'Cannot move to in_review: at least one of feature_branch, commit_sha, or pr_url is required.' },
          { status: 400 }
        )
      }
      // MC-349: regression_test required — builder must describe how to verify no regression
      if (!merged.regression_test?.trim()) {
        return NextResponse.json(
          { error: 'Cannot move to in_review: regression_test is required. Describe the command or manual steps to verify no regression (e.g. "npm run build && npm test" or "manual: verify X on mobile").' },
          { status: 400 }
        )
      }
      // Set assignee for review: use reviewer field if already set (preferred — set during grooming by PO/KAOS).
      // Only fall back to severity-mapped default if reviewer is null (e.g. legacy issue or missed grooming).
      if (!fields.assignee) {
        const existingReviewer = fields.reviewer ?? before?.reviewer
        if (existingReviewer) {
          fields.assignee = existingReviewer
        } else {
          // Fallback: derive from severity and also record in reviewer for future reference
          const tier = fields.severity ?? before?.severity
          let derivedReviewer: string
          if (tier === 'S0') {
            derivedReviewer = 'designer'
          } else if (tier === 'S1') {
            derivedReviewer = 'tester'
          } else if (tier === 'S2') {
            derivedReviewer = 'po'
          } else if (tier === 'S3') {
            derivedReviewer = 'main'
          } else {
            derivedReviewer = 'tester'  // last resort if severity not set
          }
          fields.assignee = derivedReviewer
          fields.reviewer = derivedReviewer  // persist the fallback so it's recorded
        }
      }
    }

    // To 'done': require resolution_type AND reviewer_notes AND test_status='passed'
    // Fallback: accept reviewer notes in description (for backward compat before DB migration)
    if (fields.status === 'done') {
      const hasReviewerNotes = merged.reviewer_notes ||
        (merged.description && /REVIEW/i.test(merged.description))
      const missing: string[] = []
      if (!merged.resolution_type) missing.push('resolution_type')
      if (!hasReviewerNotes) missing.push('reviewer_notes')
      if (merged.test_status !== 'passed') missing.push('test_status=passed')
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot move to done: missing required fields: ${missing.join(', ')}. Tester must set resolution_type, reviewer_notes, and test_status=passed.` },
          { status: 400 }
        )
      }
    }

    // ── MC-360: Per-type status transition validation ──
    const issueType = (fields.type ?? before?.type ?? 'task') as string

    // Ops & Research: cannot enter in_review
    if (fields.status === 'in_review' && (issueType === 'ops' || issueType === 'research')) {
      return NextResponse.json(
        { error: `Cannot move ${issueType} issue to in_review. ${issueType} issues skip review: use backlog → open → in_progress → done.` },
        { status: 400 }
      )
    }

    // Epic: only draft, active, completed, backlog are valid statuses
    if (issueType === 'epic' && !['draft', 'active', 'completed', 'backlog'].includes(fields.status)) {
      return NextResponse.json(
        { error: `Invalid status "${fields.status}" for epic. Epics only support: draft, active, completed, backlog.` },
        { status: 400 }
      )
    }

    // Feature: cannot jump from backlog directly to in_review
    if (issueType === 'feature' && fields.status === 'in_review' && before?.status === 'backlog') {
      return NextResponse.json(
        { error: 'Feature cannot jump from backlog to in_review. Move through open → in_progress first.' },
        { status: 400 }
      )
    }

    // Sprint required if moving to open/in_progress/in_review
    if (['open', 'in_progress', 'in_review'].includes(fields.status) && !merged.sprint) {
      return NextResponse.json(
        { error: 'sprint is required before moving issue out of backlog. Set sprint (YYYY-MM-DD) first.' },
        { status: 422 }
      )
    }
  }

  // ── MC-349: Auto-set timestamps + worked_by on status transitions ──
  if (fields.status) {
    const now = new Date().toISOString()

    // → in_progress: set started_at (only if not already set), set worked_by = assignee
    if (fields.status === 'in_progress') {
      if (!before?.started_at && !fields.started_at) {
        fields.started_at = now
      }
      // worked_by captures who actually worked the task (for rejection routing later)
      const effectiveAssignee = fields.assignee ?? before?.assignee
      if (effectiveAssignee && !fields.worked_by) {
        fields.worked_by = effectiveAssignee
      }
    }

    // → in_review: set submitted_at
    if (fields.status === 'in_review') {
      fields.submitted_at = now
    }

    // → done: set completed_at and reviewed_by (whoever is assignee at completion time)
    if (fields.status === 'done') {
      fields.completed_at = now
      const completingAssignee = fields.assignee ?? before?.assignee
      if (completingAssignee && !fields.reviewed_by) {
        fields.reviewed_by = completingAssignee
      }
    }

    // → open (rejection routing): if assignee not explicitly provided, route back to worked_by
    // This handles Tester rejecting a task back to the original builder
    if (fields.status === 'open' && !fields.assignee && before?.worked_by) {
      fields.assignee = before.worked_by
    }

    // → open from in_review (rejection): increment rejection_count, set timestamps
    if (fields.status === 'open' && before?.status === 'in_review') {
      fields.rejection_count = (before?.rejection_count ?? 0) + 1
      fields.last_rejected_at = new Date().toISOString()
      if (fields.reviewer_notes) {
        fields.last_rejection_reason = fields.reviewer_notes
      }
    }
  }

  // ── INF-181: Increment fail_count on test_status=failed ──
  const isNewFailure = fields.test_status === 'failed' && before?.test_status !== 'failed'
  if (isNewFailure) {
    const currentFailCount = (before?.fail_count ?? 0)
    fields.fail_count = currentFailCount + 1

    // At fail_count=3: escalate to KAOS
    if (fields.fail_count >= 3) {
      fields.status = 'blocked'
      fields.assignee = 'main'
    }
  }

  // Try update with all fields; if column doesn't exist, retry without unknown fields
  let { data, error } = await supabase
    .from('issues')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  // Graceful fallback: strip fields that don't exist as columns yet (pre-migration)
  if (error?.code === '42703') {
    const safeFields = { ...fields }
    for (const col of ['commit_sha', 'implementation_notes', 'reviewer_notes', 'fail_count',
                        'started_at', 'submitted_at', 'completed_at', 'worked_by', 'regression_test',
                        'rejection_count', 'last_rejected_at', 'last_rejection_reason',
                        'reviewer', 'reviewed_by']) {
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

  // ── Instant Discord notification on every done ──
  const resolvedType = fields.resolution_type ?? data?.resolution_type
  if (fields.status === 'done' && data) {
    notifyDiscord({ ...data, resolution_type: resolvedType })
  }

  // ── Item 4: Immediately activate next agent on status transition ──
  // Fire-and-forget: don't wait, don't block, polling automations are the fallback
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

  // ── Tester failure notification (INF-193) ──
  if (isNewFailure && data) {
    notifyTestFailure(data)
    // ── INF-181: Escalation at 3 failures ──
    if ((data.fail_count ?? 0) >= 3) {
      notifyEscalation(data)
    }
  }

  // ── INF-258: UX gate — when UX review child is marked done, complete the parent ──
  if (fields.status === 'done' && before?.assignee === 'ux' && before?.parent_id) {
    const parentId = before.parent_id
    const uxKey = before.task_key ?? data?.task_key ?? '?'

    // Mark parent issue as done (UX approved)
    const { data: parentData } = await supabase
      .from('issues')
      .update({
        status: 'done',
        updated_at: new Date().toISOString()
      })
      .eq('id', parentId)
      .select()
      .single()

    if (parentData) {
      notifyDiscord({ ...parentData, resolution_type: parentData.resolution_type ?? 'code_change' })
      console.log(`[ux-gate] ${uxKey} approved → parent ${parentData.task_key} marked done`)
    }
  }

  // ── INF-258: UX gate — when UX review child fails, create fix task and reopen parent ──
  if (isNewFailure && before?.assignee === 'ux' && before?.parent_id && data) {
    const uxNotes = (data.description ?? '').slice(0, 300)
    // Create fix task assigned to builder
    await supabase.from('issues').insert({
      title: `UX Fix: ${before.title ?? data.title}`,
      description: `UX review failed for parent issue. Fix the following UX issues:\n\n${uxNotes}`,
      project: 'Mission Control',
      type: 'task',
      priority: 'high',
      assignee: 'builder',
      acceptance_criteria: 'Address all UX review feedback. Re-submit for UX review.',
      sprint: new Date().toISOString().split('T')[0],
      parent_id: before.parent_id,
      severity: 'S2'
    })
    console.log(`[ux-gate] UX review failed for ${data.task_key} → fix task created for builder`)
  }

  // MC-372: Epic auto-completion — if a child moves to done, check parent Epic
  if (fields.status === 'done' && data?.parent_id) {
    const parentId = data.parent_id;

    // Fetch the parent to check if it is an Epic
    const { data: parentIssue } = await supabase
      .from('issues')
      .select('id, type, status, task_key, title, project')
      .eq('id', parentId)
      .single();

    if (parentIssue?.type === 'epic' && parentIssue.status !== 'completed') {
      // Fetch all children of this epic
      const { data: children } = await supabase
        .from('issues')
        .select('id, status')
        .eq('parent_id', parentId);

      const allDone = children && children.length > 0 && children.every(c => c.status === 'done');

      if (allDone) {
        await supabase
          .from('issues')
          .update({ status: 'completed', updated_at: new Date().toISOString() })
          .eq('id', parentId);

        console.log(`[epic-auto-complete] Epic ${parentIssue.task_key} auto-completed — all ${children.length} children done`);
      }
    }
  }

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('issues').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
