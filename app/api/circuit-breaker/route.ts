// TOD-767/768: Circuit Breaker — track consecutive 5xx from LLM providers
//
// POST /api/circuit-breaker  { provider, error }  — record a 5xx failure
// GET  /api/circuit-breaker                        — read circuit state
// DELETE /api/circuit-breaker { provider }         — reset a provider's counter

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'

const AGENT_ID = 'circuit-breaker'
const TRIP_THRESHOLD = 5
const COOLDOWN_MS = 10 * 60 * 1000  // 10 minutes

interface ProviderState {
  consecutive_failures: number
  last_failure_at: string | null
  last_error: string | null
  tripped: boolean
  tripped_at: string | null
}

interface BreakerState {
  providers: Record<string, ProviderState>
  updated_at: string
}

async function readState(db: ReturnType<typeof createAdminClient>): Promise<BreakerState> {
  const { data } = await db
    .from('agent_memory')
    .select('value')
    .eq('agent_id', AGENT_ID)
    .eq('key', 'state')
    .single()

  if (!data?.value) return { providers: {}, updated_at: new Date().toISOString() }
  const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
  return v as BreakerState
}

/** Returns the write error (if any) rather than swallowing it — callers decide how loud to be. */
async function writeState(db: ReturnType<typeof createAdminClient>, state: BreakerState): Promise<string | null> {
  const { error } = await db.from('agent_memory').upsert(
    { agent_id: AGENT_ID, key: 'state', value: state },
    { onConflict: 'agent_id,key' }
  )
  return error ? error.message : null
}

/** GET — return current circuit state for all providers */
export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const db = createAdminClient()
  const state = await readState(db)

  // Auto-reset tripped providers after cooldown
  const now = Date.now()
  let changed = false
  for (const [, ps] of Object.entries(state.providers)) {
    if (ps.tripped && ps.tripped_at && now - new Date(ps.tripped_at).getTime() > COOLDOWN_MS) {
      ps.tripped = false
      ps.consecutive_failures = 0
      ps.tripped_at = null
      changed = true
    }
  }
  let writeError: string | null = null
  if (changed) {
    state.updated_at = new Date().toISOString()
    writeError = await writeState(db, state)
  }

  return NextResponse.json(writeError ? { ...state, _warning: `auto-reset write failed: ${writeError}` } : state)
}

/** POST — record a 5xx failure for a provider */
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as { provider?: string; error?: string }
  if (!body.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 })

  const db = createAdminClient()
  const state = await readState(db)
  const now = new Date().toISOString()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  const ps: ProviderState = state.providers[body.provider] ?? {
    consecutive_failures: 0, last_failure_at: null, last_error: null, tripped: false, tripped_at: null,
  }

  ps.consecutive_failures += 1
  ps.last_failure_at = now
  ps.last_error = body.error ?? null

  let justTripped = false
  if (!ps.tripped && ps.consecutive_failures >= TRIP_THRESHOLD) {
    ps.tripped = true
    ps.tripped_at = now
    justTripped = true
  }

  state.providers[body.provider] = ps
  state.updated_at = now
  const writeError = await writeState(db, state)
  if (writeError) {
    return NextResponse.json({ error: `failed to persist circuit-breaker state: ${writeError}` }, { status: 500 })
  }

  if (justTripped) {
    // Pause all agents
    fetch(`${appUrl}/api/hub-pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true, paused_by: 'circuit-breaker' }),
    }).catch(() => {})

    // Discord alert
    fetch(`${appUrl}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 **Circuit breaker tripped** — provider: \`${body.provider}\`\nFailures: ${ps.consecutive_failures} | At: ${now}\nLast error: ${body.error ?? '—'}\n\nAll agents paused. Will auto-reset after 10 min.`,
        channels: ['discord-alerts'],
      }),
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, provider: body.provider, state: ps, tripped: justTripped })
}

/** DELETE — reset a provider's counter (manual recovery) */
export async function DELETE(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as { provider?: string }
  if (!body.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 })

  const db = createAdminClient()
  const state = await readState(db)
  const now = new Date().toISOString()

  state.providers[body.provider] = {
    consecutive_failures: 0, last_failure_at: null, last_error: null, tripped: false, tripped_at: null,
  }
  state.updated_at = now
  const writeError = await writeState(db, state)
  if (writeError) {
    return NextResponse.json({ error: `failed to persist circuit-breaker reset: ${writeError}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, provider: body.provider, reset: true })
}
