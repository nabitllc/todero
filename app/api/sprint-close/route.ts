import { NextRequest, NextResponse } from 'next/server'
import { getHubClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'
import { toBoundaryString } from '@/lib/bolt-time'
import { sendDiscordMessage } from '@/lib/discord-sender'

// ── Discord ───────────────────────────────────────────────────────────────────
const SPRINT_CLOSE_CHANNEL = '1491991699986055208'  // #sprint-close (metrics)
const RETRO_CHANNEL = '1491991717644075238'         // #retro

// pieces7/one-discord-sender: was `console.error('[discord] DISCORD_BOT_TOKEN
// missing — message dropped')` — a log line nobody watching the app ever
// sees, i.e. a silent drop from the operator's point of view. Now goes
// through the shared sender (still logs, but via the one place every other
// caller's drop is also logged), resolving THIS hub's own Discord connection
// first — this route has `business_id` in scope, unlike most other callers —
// and the process-wide env var only as the fallback for a hub with none.
function postDiscord(channelId: string, content: string, businessId?: string) {
  void sendDiscordMessage(channelId, content, businessId)
}

// Terminal statuses — issues in these states are "done" and not carried over
const TERMINAL_STATUSES = ['closed', 'completed', 'released']

// ── POST /api/sprint-close ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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
        // TOD-2414: local stamp, matching lib/bolt-time.ts's parser.
        end_date: toBoundaryString(),
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
    postDiscord(SPRINT_CLOSE_CHANNEL, closeMsg, business_id)

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
    postDiscord(RETRO_CHANNEL, retroMsg, business_id)

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
