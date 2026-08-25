// lib/loop-breaker.ts — TOD-766: Agent loop breaker
//
// Tracks consecutive test failures per agent in agent_memory.
// After 3 consecutive failures: sets is_paused=true, marks issue is_blocked,
// posts to Discord #alerts, and creates an inbox request.
// Resets the counter when an issue succeeds (test_status=passed).

import { db } from '@/lib/db'
const DISCORD_ALERTS_CHANNEL = '1485333335868834063'

/** Read one `agent_memory` value, or null when absent or unreadable. */
async function readMemoryValue<T>(agentId: string, key: string): Promise<T | null> {
  const { data, error } = await db()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', agentId)
    .eq('key', key)
    .limit(1)
  if (error) return null
  return ((data ?? []) as Array<{ value: T }>)[0]?.value ?? null
}

/**
 * Write one `agent_memory` value, replacing whatever was there.
 *
 * onConflict is load-bearing, not decoration: agent_memory's real uniqueness
 * is UNIQUE(agent_id, key) (it predates the migrations directory — see
 * migrations/016_agent_documents.sql's note), not its `id` primary key.
 * Omitting onConflict makes the seam default to the primary key, which is
 * never present in this payload, so every call INSERTs a fresh row instead
 * of updating the existing one — silently, no error. Throws on a real write
 * failure rather than swallowing it, so callers that track state this
 * function is supposed to persist (is_paused, loop_breaker) never proceed
 * believing a write landed when it didn't.
 */
async function writeMemoryValue(agentId: string, key: string, value: unknown): Promise<void> {
  const { error } = await db().from('agent_memory').upsert({
    agent_id: agentId,
    key,
    value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_id,key' })
  if (error) {
    throw new Error(`[loop-breaker] agent_memory write failed for ${agentId}/${key}: ${error.message}`)
  }
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
  const value = await readMemoryValue<{ paused?: boolean }>(agentId, 'is_paused')
  return value?.paused === true
}

/** Record a test failure for the agent; pause if 3 consecutive failures reached. */
export async function recordAgentFailure(
  agentId: string,
  issueId: string,
  issueTitle?: string
): Promise<void> {
  // Read current consecutive failure count
  const current = (await readMemoryValue<LoopBreakerState>(agentId, 'loop_breaker'))
    ?? { consecutive_failures: 0, last_failure_at: '' }
  const newCount = (current.consecutive_failures ?? 0) + 1

  // Persist updated state
  await writeMemoryValue(agentId, 'loop_breaker', {
    consecutive_failures: newCount,
    last_failure_at: new Date().toISOString(),
    last_issue_id: issueId,
  } satisfies LoopBreakerState)

  // Append to per-agent failure history (queryable audit log)
  const historyEntry = {
    issue_id: issueId,
    issue_title: issueTitle ?? null,
    failed_at: new Date().toISOString(),
    consecutive_count: newCount,
  }
  const stored = await readMemoryValue<unknown[]>(agentId, 'loop_breaker_history')
  const existingHistory: unknown[] = Array.isArray(stored) ? stored : []
  // Keep last 50 entries
  await writeMemoryValue(agentId, 'loop_breaker_history', [
    ...existingHistory.slice(-49),
    historyEntry,
  ])

  if (newCount >= MAX_CONSECUTIVE_FAILURES) {
    await pauseAgent(agentId, issueId, issueTitle)
  }
}

/** Reset consecutive failure count on agent success (test passed / issue approved). */
export async function resetAgentFailures(agentId: string): Promise<void> {
  await writeMemoryValue(agentId, 'loop_breaker', {
    consecutive_failures: 0,
    last_failure_at: new Date().toISOString(),
  } satisfies LoopBreakerState)
}

async function pauseAgent(agentId: string, issueId: string, issueTitle?: string): Promise<void> {
  const now = new Date().toISOString()

  // Mark agent as paused in agent_memory
  await writeMemoryValue(agentId, 'is_paused', {
    paused: true,
    paused_at: now,
    reason: `Loop breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive test failures`,
    last_issue_id: issueId,
  })

  // Mark the failing issue as is_blocked so main (KAOS) picks it up for triage
  await db()
    .from('issues')
    .update({ is_blocked: true, blocked_by: 'system:loop_breaker', updated_at: now })
    .eq('id', issueId)

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
  await db().from('inbox').insert({
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
  })
}
