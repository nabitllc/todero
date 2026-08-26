// Phase 6 (TOD-1514): Send chat message to an agent — replaces 501 stub
// Forwards the last assistant message to a specified agent via the run-agent queue.
import { NextRequest, NextResponse } from 'next/server'

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'kaos-internal-2026'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

const AGENT_LABELS: Record<string, string> = {
  builder:  'Builder',
  ops:      'Ingo (Ops)',
  po:       'Product Owner',
  scout:    'Scout',
  tester:   'Tester',
  auditor:  'Auditor',
  deployer: 'Deployer',
  designer: 'Designer',
}

export async function POST(req: NextRequest) {
  const { agentId, message, sessionKey } = await req.json().catch(() => ({})) as {
    agentId?: string
    message?: string
    sessionKey?: string
  }

  if (!agentId || !message) {
    return NextResponse.json({ error: 'agentId and message required' }, { status: 400 })
  }

  const label = AGENT_LABELS[agentId] ?? agentId

  // Attempt to nudge the agent via run-agent (best-effort — agent picks up next available task)
  //
  // `agentStatus` starts as an admission, not a claim. It used to start at
  // 'nudged', and the catch below is empty, so a run-agent that 404'd, refused,
  // or was never reached reported the SAME "Agent status: nudged." as one that
  // actually queued the work. The user is told their message was forwarded
  // either way. Same defect class as the rest of this sweep: a failure wearing
  // the successful answer's clothes.
  let agentStatus = 'could not confirm the agent was notified'
  try {
    const kickRes = await fetch(`${BASE_URL}/api/run-agent?agent=${encodeURIComponent(agentId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ context: message.slice(0, 500), sessionKey }),
    })
    const kickData = await kickRes.json().catch(() => ({}))
    if (kickData?.ok) {
      agentStatus = `spawned on task: ${kickData.task || kickData.taskKey || 'next in queue'}`
    } else if (kickData?.wip != null) {
      agentStatus = `already at WIP limit (${kickData.wip}) — will pick up next cycle`
    } else if (kickData?.message?.includes('No eligible') || kickData?.message?.includes('No DoR')) {
      agentStatus = 'no eligible tasks in queue right now'
    } else if (kickData?.paused) {
      agentStatus = 'paused (loop breaker active)'
    } else if (!kickRes.ok) {
      agentStatus = `run-agent answered ${kickRes.status} — the agent was NOT notified`
    } else {
      agentStatus = 'run-agent accepted the nudge but reported no task'
    }
  } catch (err) {
    // Naming the failure keeps "forwarded" from meaning two different things.
    agentStatus = `run-agent could not be reached — ${err instanceof Error ? err.message : String(err)}`
  }

  return NextResponse.json({
    ok: true,
    reply: `Message forwarded to **${label}**.\nAgent status: ${agentStatus}.\n\nThe agent will incorporate this context on its next task claim.`,
  })
}
