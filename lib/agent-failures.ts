// TOD-765: Loop Breaker — per-agent consecutive failure tracking
// Uses agent_failures table if available; falls back to agent_memory key='failure_tracking'.
// Increment on identical error (same hash), reset on different error or success.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

export interface AgentFailureState {
  agent_id: string
  failure_count: number
  last_error_hash: string | null
  last_error_msg: string | null
  last_failure_at: string | null
  updated_at: string
}

/** Simple hash — first 120 chars of error message, lowercased */
function hashError(msg: string): string {
  return msg.trim().toLowerCase().slice(0, 120)
}

/** Read failure state for one agent (returns null if no record exists) */
export async function getAgentFailures(agentId: string): Promise<AgentFailureState | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Try dedicated table first
  const { data: row, error } = await supabase
    .from('agent_failures')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle()

  if (!error && row) return row as AgentFailureState

  // Fall back to agent_memory
  const { data: mem } = await supabase
    .from('agent_memory')
    .select('value, updated_at')
    .eq('agent_id', agentId)
    .eq('key', 'failure_tracking')
    .maybeSingle()

  if (!mem) return null
  const v = typeof mem.value === 'string' ? JSON.parse(mem.value) : mem.value
  return { agent_id: agentId, updated_at: mem.updated_at, ...v } as AgentFailureState
}

/** Read failure state for all agents that have a record */
export async function getAllAgentFailures(): Promise<AgentFailureState[]> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Try dedicated table first
  const { data: rows, error } = await supabase
    .from('agent_failures')
    .select('*')
    .order('failure_count', { ascending: false })

  if (!error && rows && rows.length >= 0) return rows as AgentFailureState[]

  // Fall back to agent_memory
  const { data: mems } = await supabase
    .from('agent_memory')
    .select('agent_id, value, updated_at')
    .eq('key', 'failure_tracking')

  if (!mems) return []
  return mems.map((m) => {
    const v = typeof m.value === 'string' ? JSON.parse(m.value) : m.value
    return { agent_id: m.agent_id, updated_at: m.updated_at, ...v } as AgentFailureState
  })
}

/**
 * Record a failure for an agent.
 * - Same error hash → increment failure_count
 * - Different error  → reset to 1 with new hash
 */
export async function recordAgentFailure(
  agentId: string,
  errorMsg: string,
): Promise<AgentFailureState> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const hash = hashError(errorMsg)
  const now = new Date().toISOString()

  const existing = await getAgentFailures(agentId)
  const isSameError = existing?.last_error_hash === hash
  const newCount = isSameError ? (existing!.failure_count + 1) : 1

  const state: AgentFailureState = {
    agent_id: agentId,
    failure_count: newCount,
    last_error_hash: hash,
    last_error_msg: errorMsg.slice(0, 500),
    last_failure_at: now,
    updated_at: now,
  }

  // Try dedicated table
  const { error } = await supabase
    .from('agent_failures')
    .upsert(state, { onConflict: 'agent_id' })

  if (error) {
    // Fall back to agent_memory
    const { agent_id, ...value } = state
    await supabase.from('agent_memory').upsert(
      { agent_id, key: 'failure_tracking', value },
      { onConflict: 'agent_id,key' },
    )
  }

  return state
}

/**
 * Reset failure count to 0 on agent success.
 */
export async function resetAgentFailures(agentId: string): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  const now = new Date().toISOString()

  const state = {
    agent_id: agentId,
    failure_count: 0,
    last_error_hash: null,
    last_error_msg: null,
    last_failure_at: null,
    updated_at: now,
  }

  // Try dedicated table
  const { error } = await supabase
    .from('agent_failures')
    .upsert(state, { onConflict: 'agent_id' })

  if (error) {
    // Fall back to agent_memory
    const { agent_id, ...value } = state
    await supabase.from('agent_memory').upsert(
      { agent_id, key: 'failure_tracking', value },
      { onConflict: 'agent_id,key' },
    )
  }
}
