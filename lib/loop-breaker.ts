// lib/loop-breaker.ts — TOD-766: Agent loop breaker
//
// Tracks consecutive test failures per agent in agent_memory.
// After 3 consecutive failures: sets is_paused=true, marks issue is_blocked,
// posts to Discord #alerts, and creates an inbox request.
// Resets the counter when an issue succeeds. The trigger is the DERIVED
// verdict at app/api/issues/route.ts:2515 — `derivedTestStatus === 'passed'
// && before?.tester_status !== 'passed'` — i.e. a real `tester_status`
// transition into 'passed'. This line said "(test_status=passed)" until
// pieces9/run-safety-ceilings; there is no `test_status` column on `issues`
// and the MC API answers 422 for it (measured), so the old wording named a
// trigger that could never occur and sent a reader looking for a field that
// does not exist. See lib/issues.ts's tombstone.

import { db } from '@/lib/db'
import { sendDiscordMessage } from '@/lib/discord-sender'
const DISCORD_ALERTS_CHANNEL = '1485333335868834063'

/**
 * Read one `agent_memory` value, or null when the row is genuinely absent.
 *
 * Throws on a DB read error instead of returning null. A null return used to
 * mean two different things — "no row" and "couldn't ask" — and callers like
 * isAgentPaused() collapsed both to `false`. That fails OPEN: a DB hiccup
 * while checking pause state handed work to an agent the loop breaker had
 * paused. Callers that can legitimately treat "couldn't check" as "absent"
 * must catch this explicitly and say so, not fall through silently.
 */
async function readMemoryValue<T>(agentId: string, key: string): Promise<T | null> {
  const { data, error } = await db()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', agentId)
    .eq('key', key)
    .limit(1)
  if (error) {
    throw new Error(`[loop-breaker] agent_memory read failed for ${agentId}/${key}: ${error.message}`)
  }
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

// pieces7/one-discord-sender: recordAgentFailure()/pauseAgent() carry no
// business_id — their callers (app/api/run-agent, app/api/inbox,
// app/api/hub-pause) are outside this piece's owned files, so this stays a
// process-wide-only send rather than threading a hub id through a public
// API this piece does not own the callers of. Resolution now goes through
// the shared sender instead of reading process.env.DISCORD_BOT_TOKEN
// directly; a missing credential is logged there instead of swallowed here.
function postDiscordAlert(content: string): void {
  void sendDiscordMessage(DISCORD_ALERTS_CHANNEL, content)
}

const MAX_CONSECUTIVE_FAILURES = 3

interface LoopBreakerState {
  consecutive_failures: number
  last_failure_at: string
  last_issue_id?: string
}

/**
 * Returns true if the agent has been paused by the loop breaker.
 *
 * Propagates a DB read failure rather than swallowing it to `false` — a
 * caller that cannot confirm an agent is unpaused must not dispatch work to
 * it. Fail closed, not open.
 */
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

  // Mark agent as paused in agent_memory. writeMemoryValue throws on a real
  // write failure — let that propagate; a caller of recordAgentFailure
  // catching it beats one believing the agent is paused when it isn't.
  await writeMemoryValue(agentId, 'is_paused', {
    paused: true,
    paused_at: now,
    reason: `Loop breaker: ${MAX_CONSECUTIVE_FAILURES} consecutive test failures`,
    last_issue_id: issueId,
  })

  // Mark the failing issue as is_blocked so main (KAOS) picks it up for
  // triage. Checked, not fire-and-forget: an unchecked failure here means
  // the agent_memory row above says "paused" while the issue itself stays
  // fully dispatchable — the exact silent half-write this piece exists to
  // close. The Discord alert below states which of the two actually landed
  // instead of asserting the issue was blocked unconditionally.
  const { error: blockError } = await db()
    .from('issues')
    .update({ is_blocked: true, blocked_by: 'system:loop_breaker', updated_at: now })
    .eq('id', issueId)
  const issueBlocked = !blockError
  if (blockError) {
    console.warn(`[loop-breaker] failed to mark issue ${issueId} is_blocked (${blockError.message}) — agent '${agentId}' is paused but the issue it was working is still dispatchable.`)
  }

  // Post to Discord #alerts — agent pauses are otherwise silent. State what
  // actually happened, not what was attempted.
  postDiscordAlert(
    `🛑 **Agent Paused — Loop Breaker**\n` +
    `Agent \`${agentId}\` paused after ${MAX_CONSECUTIVE_FAILURES} consecutive spawn failures.\n` +
    `Last issue: ${issueTitle ?? issueId}\n` +
    (issueBlocked
      ? `Issue marked \`is_blocked\` — main agent will triage.\n`
      : `⚠️ Issue could NOT be marked \`is_blocked\` (${blockError?.message}) — it is still dispatchable even though the agent is paused. Needs manual triage.\n`) +
    `To un-pause: \`PATCH /api/agent-pause {"agent":"${agentId}","paused":false}\`\n` +
    `<@409194957098713088> please investigate.`
  )

  // Create inbox request for human review (no timeout — human must un-pause).
  // Checked for the same reason as the issues.update above: a silent insert
  // failure here means the human review this pause depends on never gets
  // raised at all, and nothing else surfaces that it didn't.
  const { error: inboxError } = await db().from('inbox').insert({
    agent: agentId,
    type: 'loop_breaker_pause',
    context: {
      reason: `${MAX_CONSECUTIVE_FAILURES} consecutive spawn failures`,
      last_issue_id: issueId,
      last_issue_title: issueTitle ?? null,
      paused_at: now,
      issue_blocked: issueBlocked,
      action_required: `Review agent '${agentId}' failures and un-pause via: PATCH /api/agent-pause body={"agent":"${agentId}","paused":false}`,
    },
    status: 'pending',
  })
  if (inboxError) {
    console.warn(`[loop-breaker] inbox insert failed for agent '${agentId}' (${inboxError.message}) — this pause will not appear for human review until someone notices the agent is stuck.`)
  }
}
