import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DISCORD_CHANNEL = '1487584901678104698'
const PROJECT_EMOJI: Record<string, string> = {
  Vespera: '🖤', Kemuni: '🚀', 'Mission Control': '🧠', Infrastructure: '⚙️'
}

const RES_LABEL: Record<string, string> = {
  code_change: '🚢 shipped', config_change: '⚙️ config', by_design: '✏️ by design',
  wont_fix: '🚫 won\'t fix', canceled: '❌ canceled', duplicate: '🔁 duplicate',
  cannot_reproduce: '❓ cannot reproduce'
}

function notifyDiscord(issue: { task_key?: string; title?: string; project?: string; resolution_type?: string; assignee?: string; test_tier?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const res = RES_LABEL[issue.resolution_type ?? ''] ?? issue.resolution_type ?? 'done'
  const tier = issue.test_tier ? ` · ${issue.test_tier}` : ''
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
          acceptance_criteria, sprint, parent_id, test_tier, resolution_type,
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

  // MC-210: Always generate task_key server-side to prevent race conditions
  const generated = await generateTaskKey(project)

  const { data, error } = await supabase
    .from('issues')
    .insert({
      title, description: effectiveDescription, status: effectiveStatus,
      assignee: effectiveAssignee, project,
      priority: priority ?? 'medium', type: type ?? 'task', due_date,
      acceptance_criteria, sprint, parent_id,
      ...(test_tier ? { test_tier } : {}),
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

    // To 'open': require priority, sprint, assignee, acceptance_criteria
    if (fields.status === 'open') {
      const missing: string[] = []
      if (!merged.priority) missing.push('priority')
      if (!merged.sprint) missing.push('sprint')
      if (!merged.assignee) missing.push('assignee')
      if (!merged.acceptance_criteria) missing.push('acceptance_criteria')
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot move to open: missing required fields: ${missing.join(', ')}. All open issues need priority, sprint, assignee, and acceptance_criteria.` },
          { status: 400 }
        )
      }
    }

    // To 'in_review': require (feature_branch OR commit_sha OR pr_url) AND implementation_notes
    if (fields.status === 'in_review') {
      if (!merged.implementation_notes) {
        return NextResponse.json(
          { error: 'Cannot move to in_review: implementation_notes is required. Builder must include handoff notes for the reviewer.' },
          { status: 400 }
        )
      }
      if (!merged.feature_branch && !merged.commit_sha && !merged.pr_url) {
        return NextResponse.json(
          { error: 'Cannot move to in_review: at least one of feature_branch, commit_sha, or pr_url is required.' },
          { status: 400 }
        )
      }
      // Auto-set assignee=tester if not explicitly provided
      if (!fields.assignee) {
        fields.assignee = 'tester'
      }
    }

    // To 'done': require resolution_type AND reviewer_notes AND test_status='passed'
    if (fields.status === 'done') {
      const missing: string[] = []
      if (!merged.resolution_type) missing.push('resolution_type')
      if (!merged.reviewer_notes) missing.push('reviewer_notes')
      if (merged.test_status !== 'passed') missing.push('test_status=passed')
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot move to done: missing required fields: ${missing.join(', ')}. Tester must set resolution_type, reviewer_notes, and test_status=passed.` },
          { status: 400 }
        )
      }
    }

    // Sprint required if moving to open/in_progress/in_review
    if (['open', 'in_progress', 'in_review'].includes(fields.status) && !merged.sprint) {
      return NextResponse.json(
        { error: 'sprint is required before moving issue out of backlog. Set sprint (YYYY-MM-DD) first.' },
        { status: 422 }
      )
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

  const { data, error } = await supabase
    .from('issues')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Instant Discord notification on every done ──
  const resolvedType = fields.resolution_type ?? data?.resolution_type
  if (fields.status === 'done' && data) {
    notifyDiscord({ ...data, resolution_type: resolvedType })
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
      test_tier: 'P2'
    })
    console.log(`[ux-gate] UX review failed for ${data.task_key} → fix task created for builder`)
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
