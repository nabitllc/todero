// lib/loop-breaker.ts — TOD-766: Agent loop breaker
//
// Tracks consecutive test failures per agent in agent_memory.
// After 3 consecutive failures: sets is_paused=true and creates an inbox request.
// Resets the counter when an issue succeeds (test_status=passed).

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
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

  // Create inbox request for human review (no timeout — human must un-pause)
  await fetch(`${SUPA_URL}/rest/v1/inbox`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      agent: agentId,
      type: 'loop_breaker_pause',
      context: {
        reason: `${MAX_CONSECUTIVE_FAILURES} consecutive test failures`,
        last_issue_id: issueId,
        last_issue_title: issueTitle ?? null,
        paused_at: now,
        action_required: `Review agent '${agentId}' failures and un-pause via: PATCH /api/agent-pause body={"agent":"${agentId}","paused":false}`,
      },
      status: 'pending',
    }),
  })
}
