// TOD-632: Play/Pause toggle — pauses all agent heartbeats
// Uses agent_memory table so agent-kicker and run-agent can read pause state.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'

const AGENT_ID = 'system'
const KEY = 'hub_pause'

// Agents that can be paused
const HEARTBEAT_AGENTS = ['main', 'scout', 'ops', 'builder', 'tester', 'designer', 'po', 'deployer', 'auditor']

interface PauseValue {
  paused: boolean
  paused_at: string | null
  paused_by: string
  updated_at: string
  paused_agents: string[]
}

/** GET — read current pause state */
export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  try {
    const db = createAdminClient()
    const { data, error } = await db
      .from('agent_memory')
      .select('value')
      .eq('agent_id', AGENT_ID)
      .eq('key', KEY)
      .single()

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const val = data?.value
      ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) as PauseValue
      : null

    return NextResponse.json({
      paused: val?.paused ?? false,
      paused_at: val?.paused_at ?? null,
      paused_by: val?.paused_by ?? null,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** POST — toggle pause: { paused: boolean }
 *  PAUSE:  writes is_paused=true to each agent's memory row
 *  RESUME: writes is_paused=false to each agent's memory row
 *  agent-kicker reads the run-agent response paused field, which reads from agent_memory
 */
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  try {
    const body = await req.json() as { paused?: boolean; paused_by?: string }
    const paused = Boolean(body.paused)
    const db = createAdminClient()

    // Write is_paused flag to each individual agent's memory row
    // so /api/run-agent can check it before spawning
    await Promise.allSettled(
      HEARTBEAT_AGENTS.map(agentId =>
        db.from('agent_memory').upsert(
          { agent_id: agentId, key: 'is_paused', value: paused ? 'true' : 'false' },
          { onConflict: 'agent_id,key' }
        )
      )
    )

    // Write hub-level pause state for UI display
    const value: PauseValue = {
      paused,
      paused_at: paused ? new Date().toISOString() : null,
      paused_by: body.paused_by ?? 'user',
      updated_at: new Date().toISOString(),
      paused_agents: paused ? HEARTBEAT_AGENTS : [],
    }
    await db.from('agent_memory').upsert(
      { agent_id: AGENT_ID, key: KEY, value },
      { onConflict: 'agent_id,key' }
    )

    return NextResponse.json({ ok: true, paused })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
