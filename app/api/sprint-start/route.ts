import { NextRequest, NextResponse } from 'next/server'
import { getHubClient, createAdminClient } from '@/lib/hub-client'

// ── Discord ───────────────────────────────────────────────────────────────────
const SPRINT_START_CHANNEL = '1491991662757548144'

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

    const { client: db, businessId: hubId } = getHubClient(business_id)
    // Non-hub table (businesses is the root entity, not partitioned by business_id)
    const adminDb = createAdminClient()

    // 1. Check for existing active sprint
    const { data: activeSprint } = await db
      .from('sprints')
      .select('*')
      .eq('business_id', hubId)
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
    const { data: lastSprint } = await db
      .from('sprints')
      .select('sprint_number')
      .eq('business_id', hubId)
      .order('sprint_number', { ascending: false })
      .limit(1)
      .single()

    const nextNumber = (lastSprint?.sprint_number ?? 0) + 1

    // 2b. Get business name for the sprint project field
    // AGGREGATE QUERY: businesses table is not hub-scoped (it IS the hub root)
    const { data: business } = await adminDb
      .from('businesses')
      .select('name')
      .eq('id', business_id)
      .single()

    const projectName = business?.name ?? 'Unknown'

    // 3. Create new sprint (24h: today 7am to tomorrow 7am)
    const today = new Date()
    const startDate = today.toISOString().split('T')[0]
    const tomorrow = new Date(today.getTime() + 86400000)
    const endDate = tomorrow.toISOString().split('T')[0]

    const { data: newSprint, error: sprintErr } = await db
      .from('sprints')
      .insert({
        business_id: hubId,
        name: `sprint-${nextNumber}`,
        project: projectName,
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
    const { data: projects } = await db
      .from('projects')
      .select('name')
      .eq('business_id', hubId)

    const projectNames = (projects ?? []).map((p) => p.name)

    // 5. Assign unassigned / stale-sprint issues to this sprint
    let assignedCount = 0
    if (projectNames.length > 0) {
      const { data: issues } = await db
        .from('issues')
        .select('id, sprint, status, project')
        .eq('business_id', hubId)
        .in('project', projectNames)
        .not('status', 'in', '("backlog","closed","completed")')

      const toAssign = (issues ?? []).filter((iss) => {
        return !iss.sprint || iss.sprint < startDate
      })

      if (toAssign.length > 0) {
        const ids = toAssign.map((i) => i.id)
        const { error: assignErr } = await db
          .from('issues')
          .update({ sprint: startDate, updated_at: new Date().toISOString() })
          .eq('business_id', hubId)
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
    postDiscord(SPRINT_START_CHANNEL, kickoffMsg)

    return NextResponse.json({
      sprint: newSprint,
      assigned_issues_count: assignedCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
