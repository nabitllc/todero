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
  let agentStatus = 'nudged'
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
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    reply: `Message forwarded to **${label}**.\nAgent status: ${agentStatus}.\n\nThe agent will incorporate this context on its next task claim.`,
  })
}
