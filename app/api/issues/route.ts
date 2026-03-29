import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'

const DISCORD_CHANNEL = '1487584901678104698'
const PROJECT_EMOJI: Record<string, string> = {
  Vespera: '🖤', Kemuni: '🚀', 'Mission Control': '🧠', Infrastructure: '⚙️'
}

const RES_LABEL: Record<string, string> = {
  code_change: 'shipped', config_change: 'config', by_design: 'by design',
  wont_fix: 'won\'t fix', canceled: 'canceled'
}

function notifyDiscord(issue: { task_key?: string; title?: string; project?: string; resolution_type?: string }) {
  const emoji = PROJECT_EMOJI[issue.project ?? ''] ?? '📌'
  const key = issue.task_key ?? '?'
  const res = RES_LABEL[issue.resolution_type ?? ''] ?? issue.resolution_type ?? 'done'
  const msg = `${emoji} **[${key}]** ${issue.title ?? ''} · _${res}_`
  const escaped = msg.replace(/'/g, `'\\''`)
  exec(`openclaw message send --channel discord --target "channel:${DISCORD_CHANNEL}" --message '${escaped}'`,
    (err) => { if (err) console.error('[discord-notify]', err.message) })
}

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

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
          feature_branch, pr_url, task_key, task_number } = body

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

  const { data, error } = await supabase
    .from('issues')
    .insert({
      title, description: effectiveDescription, status: effectiveStatus,
      assignee: effectiveAssignee, project,
      priority: priority ?? 'medium', type: type ?? 'task', due_date,
      acceptance_criteria, sprint, parent_id,
      ...(test_tier ? { test_tier } : {}),
      resolution_type, feature_branch, pr_url,
      ...(task_key ? { task_key, task_number } : {})
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

function notifyPRReview(issue: { task_key?: string; title?: string; project?: string; feature_branch?: string; pr_url?: string }) {
  const key = issue.task_key ?? '?'
  const msg = `🔀 **PR Ready for Review**\n**[${key}]** ${issue.title ?? ''}\nProject: ${issue.project ?? ''} · Branch: ${issue.feature_branch ?? ''}\nPR: ${issue.pr_url ?? ''}\n<@409194957098713088> ready to merge`
  const escaped = msg.replace(/'/g, `'\\''`)
  exec(`openclaw message send --channel discord --target "channel:1487826368170299592" --message '${escaped}'`,
    (err) => { if (err) console.error('[discord-pr-review]', err.message) })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // ── Sprint required if moving out of backlog ──
  if (fields.status && fields.status !== 'backlog' && !fields.sprint) {
    // Check if existing issue already has a sprint
    const { data: existing } = await supabase
      .from('issues')
      .select('sprint')
      .eq('id', id)
      .single()
    if (!existing?.sprint) {
      return NextResponse.json(
        { error: 'sprint is required before moving issue out of backlog. Set sprint (YYYY-MM-DD) first.' },
        { status: 422 }
      )
    }
  }

  // ── Fetch existing record to detect pr_url transition ──
  const { data: before } = await supabase
    .from('issues')
    .select('pr_url')
    .eq('id', id)
    .single()

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

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('issues').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
