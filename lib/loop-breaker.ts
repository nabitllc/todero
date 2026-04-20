// lib/loop-breaker.ts — TOD-766: Agent loop breaker
//
// Tracks consecutive test failures per agent in agent_memory.
// After 3 consecutive failures: sets is_paused=true, marks issue is_blocked,
// posts to Discord #alerts, and creates an inbox request.
// Resets the counter when an issue succeeds (test_status=passed).

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const DISCORD_ALERTS_CHANNEL = '1485333335868834063'

const HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
}

function postDiscordAlert(content: string) {
  const token = process.env.DISCORD_BOT_TOKEN ?? ''
  if (!token) return
  void fetch(`https://discord.com/api/v10/channels/${DISCORD_ALERTS_CHANNEL}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  }).catch(() => {})
}

const MAX_CONSECUTIVE_FAILURES = 3

interface LoopBreakerState {
  consecutive_failures: number
  last_failure_at: string
  last_issue_id?: string
}

/** Returns true if the agent has been paused by the loop breaker. */
export async function isAgentPaused(agentId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.is_paused&limit=1`,
    { headers: HEADERS }
  )
  if (!res.ok) return false
  const data = await res.json() as Array<{ value: { paused?: boolean } }>
  return data[0]?.value?.paused === true
}

/** Record a test failure for the agent; pause if 3 consecutive failures reached. */
export async function recordAgentFailure(
  agentId: string,
  issueId: string,
  issueTitle?: string
): Promise<void> {
  // Read current consecutive failure count
  const stateRes = await fetch(
    `${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.loop_breaker&limit=1`,
    { headers: HEADERS }
  )
  const stateData = stateRes.ok
    ? (await stateRes.json() as Array<{ value: LoopBreakerState }>)
    : []
  const current = stateData[0]?.value ?? { consecutive_failures: 0, last_failure_at: '' }
  const newCount = (current.consecutive_failures ?? 0) + 1

  // Persist updated state
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      agent_id: agentId,
      key: 'loop_breaker',
      value: {
        consecutive_failures: newCount,
        last_failure_at: new Date().toISOString(),
        last_issue_id: issueId,
      } satisfies LoopBreakerState,
      updated_at: new Date().toISOString(),
    }),
  })

  // Append to per-agent failure history (queryable audit log)
  const historyEntry = {
    issue_id: issueId,
    issue_title: issueTitle ?? null,
    failed_at: new Date().toISOString(),
    consecutive_count: newCount,
  }
  const histRes = await fetch(
    `${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.loop_breaker_history&limit=1`,
    { headers: HEADERS }
  )
  const histData = histRes.ok ? (await histRes.json() as Array<{ value: unknown[] }>) : []
  const existingHistory: unknown[] = Array.isArray(histData[0]?.value) ? histData[0].value : []
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      agent_id: agentId,
      key: 'loop_breaker_history',
      // Keep last 50 entries
      value: [...existingHistory.slice(-49), historyEntry],
      updated_at: new Date().toISOString(),
    }),
  })

  if (newCount >= MAX_CONSECUTIVE_FAILURES) {
    await pauseAgent(agentId, issueId, issueTitle)
  }
}

/** Reset consecutive failure count on agent success (test passed / issue approved). */
export async function resetAgentFailures(agentId: string): Promise<void> {
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      agent_id: agentId,
      key: 'loop_breaker',
      value: { consecutive_failures: 0, last_failure_at: new Date().toISOString() } satisfies LoopBreakerState,
      updated_at: new Date().toISOString(),
    }),
  })
}

async function pauseAgent(agentId: string, issueId: string, issueTitle?: string): Promise<void> {
  const now = new Date().toISOString()

  // Mark agent as paused in agent_memory
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
      agent_id: agentId,
      key: 'is_paused',
      value: {
        paused: true,
        paused_at: now,
        reason: `Loop breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive test failures`,
        last_issue_id: issueId,
      },
      updated_at: now,
    }),
  })

  // Mark the failing issue as is_blocked so main (KAOS) picks it up for triage
  await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${issueId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      is_blocked: true,
      blocked_by: 'system:loop_breaker',
      updated_at: now,
    }),
  })

  // Post to Discord #alerts — agent pauses are otherwise silent
  postDiscordAlert(
    `🛑 **Agent Paused — Loop Breaker**\n` +
    `Agent \`${agentId}\` paused after ${MAX_CONSECUTIVE_FAILURES} consecutive spawn failures.\n` +
    `Last issue: ${issueTitle ?? issueId}\n` +
    `Issue marked \`is_blocked\` — main agent will triage.\n` +
    `To un-pause: \`PATCH /api/agent-pause {"agent":"${agentId}","paused":false}\`\n` +
    `<@409194957098713088> please investigate.`
  )

  // Create inbox request for human review (no timeout — human must un-pause)
  await fetch(`${SUPA_URL}/rest/v1/inbox`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      agent: agentId,
      type: 'loop_breaker_pause',
      context: {
        reason: `${MAX_CONSECUTIVE_FAILURES} consecutive spawn failures`,
        last_issue_id: issueId,
        last_issue_title: issueTitle ?? null,
        paused_at: now,
        action_required: `Review agent '${agentId}' failures and un-pause via: PATCH /api/agent-pause body={"agent":"${agentId}","paused":false}`,
      },
      status: 'pending',
    }),
  })
}
