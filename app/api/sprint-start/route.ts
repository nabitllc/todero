import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

// ── Discord ───────────────────────────────────────────────────────────────────
const COMPLETED_TASKS_CHANNEL = '1487584901678104698'

function postDiscord(channelId: string, content: string) {
  const token = process.env.DISCORD_BOT_TOKEN ?? ''
  if (!token) return
  fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
    },
    body: JSON.stringify({ content }),
  }).catch((err) => console.error('[discord]', err))
}

// ── POST /api/sprint-start ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { business_id, goal } = body

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 })
    }

    // 1. Check for existing active sprint
    const { data: activeSprint } = await supabase
      .from('sprints')
      .select('*')
      .eq('business_id', business_id)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (activeSprint) {
      return NextResponse.json(
        { error: `Active sprint already exists: ${activeSprint.name}`, active_sprint: activeSprint },
        { status: 409 }
      )
    }

    // 2. Find the last closed sprint to determine next sprint number
    const { data: lastSprint } = await supabase
      .from('sprints')
      .select('sprint_number')
      .eq('business_id', business_id)
      .order('sprint_number', { ascending: false })
      .limit(1)
      .single()

    const nextNumber = (lastSprint?.sprint_number ?? 0) + 1

    // 3. Create new sprint (24h: today 7am to tomorrow 7am)
    const today = new Date()
    const startDate = today.toISOString().split('T')[0]
    const tomorrow = new Date(today.getTime() + 86400000)
    const endDate = tomorrow.toISOString().split('T')[0]

    const { data: newSprint, error: sprintErr } = await supabase
      .from('sprints')
      .insert({
        name: `sprint-${nextNumber}`,
        business_id,
        goal: goal || `Sprint ${nextNumber} goals`,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
        sprint_number: nextNumber,
      })
      .select()
      .single()

    if (sprintErr) {
      return NextResponse.json({ error: sprintErr.message }, { status: 500 })
    }

    // 4. Find projects for this business
    const { data: projects } = await supabase
      .from('projects')
      .select('name')
      .eq('business_id', business_id)

    const projectNames = (projects ?? []).map((p) => p.name)

    // 5. Assign unassigned / stale-sprint issues to this sprint
    let assignedCount = 0
    if (projectNames.length > 0) {
      // Find non-backlog issues with no sprint or stale sprint
      const { data: issues } = await supabase
        .from('issues')
        .select('id, sprint, status, project')
        .in('project', projectNames)
        .not('status', 'in', '("backlog","closed","completed","cancelled")')

      const toAssign = (issues ?? []).filter((iss) => {
        // No sprint assigned, or sprint is from a previous date
        return !iss.sprint || iss.sprint < startDate
      })

      if (toAssign.length > 0) {
        const ids = toAssign.map((i) => i.id)
        const { error: assignErr } = await supabase
          .from('issues')
          .update({ sprint: startDate, updated_at: new Date().toISOString() })
          .in('id', ids)

        if (!assignErr) {
          assignedCount = ids.length
        }
      }
    }

    // 6. Post kickoff message to Discord
    const projectList = projectNames.length > 0 ? projectNames.join(', ') : 'No projects'
    const kickoffMsg = [
      `🚀 **Sprint ${nextNumber} Started** — \`sprint-${nextNumber}\``,
      `📅 ${startDate} → ${endDate}`,
      `🎯 Goal: ${goal || 'Sprint goals TBD'}`,
      `📦 Projects: ${projectList}`,
      `📋 ${assignedCount} issue${assignedCount !== 1 ? 's' : ''} assigned to sprint`,
    ].join('\n')
    postDiscord(COMPLETED_TASKS_CHANNEL, kickoffMsg)

    return NextResponse.json({
      sprint: newSprint,
      assigned_issues_count: assignedCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
