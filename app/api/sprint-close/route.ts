import { NextRequest, NextResponse } from 'next/server'
import { getHubClient } from '@/lib/hub-client'

// ── Discord ───────────────────────────────────────────────────────────────────
if (!process.env.DISCORD_BOT_TOKEN) {
  throw new Error('Missing env var: DISCORD_BOT_TOKEN')
}
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN

const SPRINT_CLOSE_CHANNEL = '1491991699986055208'  // #sprint-close (metrics)
const RETRO_CHANNEL = '1491991717644075238'         // #retro

function postDiscord(channelId: string, content: string) {
  fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
    },
    body: JSON.stringify({ content }),
  }).catch((err) => console.error('[discord]', err))
}

// Terminal statuses — issues in these states are "done" and not carried over
const TERMINAL_STATUSES = ['closed', 'completed', 'released']

// ── POST /api/sprint-close ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { business_id } = body

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 })
    }

    const { client: db, businessId: hubId } = getHubClient(business_id)

    // 1. Find the active sprint for this business_id
    const { data: activeSprint, error: findErr } = await db
      .from('sprints')
      .select('*')
      .eq('business_id', hubId)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (findErr || !activeSprint) {
      return NextResponse.json(
        { error: 'No active sprint found for this business_id' },
        { status: 404 }
      )
    }

    // 2. Find projects for this business
    const { data: projects } = await db
      .from('projects')
      .select('name')
      .eq('business_id', hubId)

    const projectNames = (projects ?? []).map((p) => p.name)

    // 3. Fetch all issues in this sprint
    let sprintIssues: Record<string, unknown>[] = []
    if (projectNames.length > 0) {
      const { data: issues } = await db
        .from('issues')
        .select('id, title, status, project, task_key, type, priority')
        .eq('business_id', hubId)
        .in('project', projectNames)
        .eq('sprint', activeSprint.start_date)

      sprintIssues = issues ?? []
    }

    // 4. Compute retro summary
    const byStatus: Record<string, number> = {}
    let completedCount = 0
    let carriedOverCount = 0

    for (const iss of sprintIssues) {
      const status = (iss.status as string) ?? 'unknown'
      byStatus[status] = (byStatus[status] ?? 0) + 1
      if (TERMINAL_STATUSES.includes(status)) {
        completedCount++
      } else {
        carriedOverCount++
      }
    }

    const retro = {
      total: sprintIssues.length,
      completed: completedCount,
      carried_over: carriedOverCount,
      by_status: byStatus,
    }

    // 5. Close the sprint
    const { data: closedSprint, error: closeErr } = await db
      .from('sprints')
      .update({
        status: 'closed',
        end_date: new Date().toISOString().split('T')[0],
      })
      .eq('business_id', hubId)
      .eq('id', activeSprint.id)
      .select()
      .single()

    if (closeErr) {
      return NextResponse.json({ error: closeErr.message }, { status: 500 })
    }

    // 6. Post retro to Discord
    const statusLines = Object.entries(byStatus)
      .map(([s, c]) => `  ${s}: ${c}`)
      .join('\n')

    // Sprint Close metrics → #sprint-close
    const closeMsg = [
      `🏁 **Sprint ${activeSprint.sprint_number} Closed** — \`${activeSprint.name}\``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `✅ Completed: ${completedCount}`,
      `🔄 Carried over: ${carriedOverCount}`,
      `📋 Total issues: ${sprintIssues.length}`,
      `📅 ${activeSprint.start_date} → ${activeSprint.end_date}`,
      ``,
      `**By Status:**`,
      statusLines || '  (no issues)',
    ].join('\n')
    postDiscord(SPRINT_CLOSE_CHANNEL, closeMsg)

    // Retro → #retro
    const completionRate = sprintIssues.length > 0 ? Math.round((completedCount / sprintIssues.length) * 100) : 0
    const retroMsg = [
      `📊 **Sprint ${activeSprint.sprint_number} Retro**`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `**What went well:**`,
      `• ${completedCount} issues completed (${completionRate}% completion rate)`,
      ``,
      `**What to improve:**`,
      carriedOverCount > 0 ? `• ${carriedOverCount} issues carried over — review sizing and dependencies` : `• No carryover — good sprint sizing`,
      ``,
      `**Action items for next sprint:**`,
      `• Review carried-over issues for re-prioritization`,
      `• Identify blockers that slowed progress`,
    ].join('\n')
    postDiscord(RETRO_CHANNEL, retroMsg)

    // 7. Automatically start next sprint
    let newSprint: Record<string, unknown> | null = null
    try {
      const startRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/sprint-start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id,
            goal: `Follow-up from ${activeSprint.name}`,
          }),
        }
      )
      if (startRes.ok) {
        const startData = await startRes.json()
        newSprint = startData.sprint ?? null
      }
    } catch (e) {
      console.error('[sprint-close] auto-start failed:', e)
    }

    // 8. Reassign carried-over issues to new sprint
    let carriedOverReassigned = 0
    if (newSprint && sprintIssues.length > 0) {
      const carriedOverIds = sprintIssues
        .filter((iss) => !TERMINAL_STATUSES.includes((iss.status as string) ?? ''))
        .map((iss) => iss.id as string)

      if (carriedOverIds.length > 0 && newSprint?.start_date) {
        const newSprintDate = newSprint.start_date as string
        const { error: carryErr } = await db
          .from('issues')
          .update({ sprint: newSprintDate, updated_at: new Date().toISOString() })
          .eq('business_id', hubId)
          .in('id', carriedOverIds)

        if (!carryErr) {
          carriedOverReassigned = carriedOverIds.length
        }
      }
    }

    return NextResponse.json({
      closed_sprint: closedSprint,
      retro,
      new_sprint: newSprint,
      carried_over_reassigned: carriedOverReassigned,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
