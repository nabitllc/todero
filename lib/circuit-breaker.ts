// TOD-767: Circuit Breaker — detect 5 consecutive 5xx from LLM providers
// Stores state in agent_memory. Trips at 5 consecutive 5xx → auto-calls hub-pause.
// Resets after 10-min cooldown.

import { createClient } from '@supabase/supabase-js'

// Read credentials from env. No fallback literal — if the env var is unset we
// want the app to fail loudly at import time instead of silently shipping a
// JWT into the binary (TOD-767 rejection #3).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('circuit-breaker: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const AGENT_ID = 'system'
const TRIP_THRESHOLD = 5       // consecutive 5xx before tripping
const COOLDOWN_MS = 10 * 60 * 1000  // 10 minutes

export type BreakerState = 'closed' | 'open'

export interface BreakerStatus {
  provider: string
  state: BreakerState
  consecutiveFails: number
  trippedAt: string | null
  cooldownEndsAt: string | null
}

function key(provider: string) {
  return `circuit_breaker_${provider}`
}

async function readState(provider: string): Promise<BreakerStatus> {
  const { data, error } = await supabase
    .from('agent_memory')
    .select('value')
    .eq('agent_id', AGENT_ID)
    .eq('key', key(provider))
    .single()

  if (error || !data?.value) {
    return { provider, state: 'closed', consecutiveFails: 0, trippedAt: null, cooldownEndsAt: null }
  }
  const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
  return val as BreakerStatus
}

async function writeState(status: BreakerStatus): Promise<void> {
  await supabase.from('agent_memory').upsert(
    { agent_id: AGENT_ID, key: key(status.provider), value: status },
    { onConflict: 'agent_id,key' }
  )
}

async function triggerHubPause(provider: string): Promise<void> {
  try {
    await fetch('http://localhost:3000/api/hub-pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true, paused_by: `circuit-breaker:${provider}` }),
    })
  } catch {
    // non-fatal — breaker state is already stored
  }
}

/**
 * Record an LLM API response. Call this after every provider HTTP call.
 * Returns the updated breaker status.
 */
export async function recordProviderResponse(
  provider: string,
  statusCode: number
): Promise<BreakerStatus> {
  const is5xx = statusCode >= 500 && statusCode < 600
  let status = await readState(provider)

  // Check if cooldown has expired — auto-reset
  if (status.state === 'open' && status.trippedAt) {
    const elapsed = Date.now() - new Date(status.trippedAt).getTime()
    if (elapsed >= COOLDOWN_MS) {
      status = { provider, state: 'closed', consecutiveFails: 0, trippedAt: null, cooldownEndsAt: null }
    }
  }

  if (is5xx) {
    status.consecutiveFails += 1
    if (status.consecutiveFails >= TRIP_THRESHOLD && status.state === 'closed') {
      // Trip the breaker
      const now = new Date().toISOString()
      const cooldownEnds = new Date(Date.now() + COOLDOWN_MS).toISOString()
      status = { provider, state: 'open', consecutiveFails: status.consecutiveFails, trippedAt: now, cooldownEndsAt: cooldownEnds }
      await writeState(status)
      await triggerHubPause(provider)
      return status
    }
  } else {
    // Successful response — reset counter
    status.consecutiveFails = 0
  }

  await writeState(status)
  return status
}

/**
 * Read current breaker status for a provider without modifying state.
 * If cooldown has expired, auto-resets to closed.
 */
export async function getBreakerStatus(provider: string): Promise<BreakerStatus> {
  let status = await readState(provider)

  if (status.state === 'open' && status.trippedAt) {
    const elapsed = Date.now() - new Date(status.trippedAt).getTime()
    if (elapsed >= COOLDOWN_MS) {
      status = { provider, state: 'closed', consecutiveFails: 0, trippedAt: null, cooldownEndsAt: null }
      await writeState(status)
    }
  }

  return status
}

/**
 * List breaker statuses for multiple providers.
 */
export async function getAllBreakerStatuses(providers: string[]): Promise<BreakerStatus[]> {
  return Promise.all(providers.map(p => getBreakerStatus(p)))
}
