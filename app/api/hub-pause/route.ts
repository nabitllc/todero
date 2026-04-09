// TOD-632: Play/Pause toggle — pauses all agent heartbeats + agent-invoking n8n workflows
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const N8N_KEY = 'n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const AGENT_ID = 'system'
const KEY = 'hub_pause'

// Known heartbeat agent IDs
const HEARTBEAT_AGENTS = ['main', 'scout', 'ops', 'builder', 'tester', 'designer']

interface PauseValue {
  paused: boolean
  paused_at: string | null
  paused_by: string
  updated_at: string
  disabled_workflow_ids: string[]
  disabled_heartbeats: string[]
}

// ── Helpers ──

async function toggleHeartbeat(agentId: string, enabled: boolean): Promise<boolean> {
  try {
    const action = enabled ? 'enable' : 'disable'
    await execAsync(`/opt/homebrew/bin/openclaw heartbeat ${action} ${agentId}`, { timeout: 8000 })
    return true
  } catch {
    return false
  }
}

async function getAgentInvokingWorkflowIds(): Promise<string[]> {
  try {
    const res = await fetch('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY }, cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    const workflows: any[] = data.data ?? []
    const ids: string[] = []
    for (const w of workflows) {
      const nodes: any[] = w.nodes ?? []
      const invokes = nodes.some((n: any) => {
        const code = n.parameters?.jsCode ?? n.parameters?.code ?? ''
        const url = n.parameters?.url ?? ''
        return code.includes('trigger-agent') || code.includes('run-agent')
          || code.includes('run-builder') || url.includes('trigger-agent')
          || url.includes('run-agent') || url.includes('run-builder')
      })
      if (invokes) ids.push(w.id)
    }
    return ids
  } catch {
    return []
  }
}

async function toggleN8nWorkflow(workflowId: string, active: boolean): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:5678/api/v1/workflows/${workflowId}`, {
      method: 'PATCH',
      headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** GET — read current pause state */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('agent_id', AGENT_ID)
      .eq('key', KEY)
      .single()

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const val = data?.value ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value) : null
    return NextResponse.json({
      paused: val?.paused ?? false,
      paused_at: val?.paused_at ?? null,
      paused_by: val?.paused_by ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/** POST — toggle pause: { paused: boolean }
 *  PAUSE:  disables all openclaw heartbeats + agent-invoking n8n workflows
 *  RESUME: re-enables exactly what was disabled
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const paused = Boolean(body.paused)

    const results: { heartbeats: Record<string, boolean>; workflows: Record<string, boolean> } = {
      heartbeats: {}, workflows: {},
    }

    if (paused) {
      // ── PAUSE ──
      // 1. Disable all heartbeats
      await Promise.allSettled(
        HEARTBEAT_AGENTS.map(async id => {
          results.heartbeats[id] = await toggleHeartbeat(id, false)
        })
      )
      // 2. Detect and disable agent-invoking n8n workflows
      const agentWorkflowIds = await getAgentInvokingWorkflowIds()
      await Promise.allSettled(
        agentWorkflowIds.map(async id => {
          results.workflows[id] = await toggleN8nWorkflow(id, false)
        })
      )

      const value: PauseValue = {
        paused: true,
        paused_at: new Date().toISOString(),
        paused_by: body.paused_by ?? 'user',
        updated_at: new Date().toISOString(),
        disabled_workflow_ids: agentWorkflowIds,
        disabled_heartbeats: HEARTBEAT_AGENTS,
      }
      await supabase.from('agent_memory').upsert(
        { agent_id: AGENT_ID, key: KEY, value },
        { onConflict: 'agent_id,key' }
      )
    } else {
      // ── RESUME ──
      // Read previous state to know what to re-enable
      const { data } = await supabase
        .from('agent_memory')
        .select('value')
        .eq('agent_id', AGENT_ID)
        .eq('key', KEY)
        .single()
      const prev: PauseValue | null = data?.value
        ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value)
        : null

      const hbToEnable = prev?.disabled_heartbeats?.length ? prev.disabled_heartbeats : HEARTBEAT_AGENTS
      await Promise.allSettled(
        hbToEnable.map(async id => {
          results.heartbeats[id] = await toggleHeartbeat(id, true)
        })
      )

      const wfToEnable = prev?.disabled_workflow_ids ?? []
      await Promise.allSettled(
        wfToEnable.map(async id => {
          results.workflows[id] = await toggleN8nWorkflow(id, true)
        })
      )

      const value: PauseValue = {
        paused: false,
        paused_at: null,
        paused_by: body.paused_by ?? 'user',
        updated_at: new Date().toISOString(),
        disabled_workflow_ids: [],
        disabled_heartbeats: [],
      }
      await supabase.from('agent_memory').upsert(
        { agent_id: AGENT_ID, key: KEY, value },
        { onConflict: 'agent_id,key' }
      )
    }

    return NextResponse.json({ ok: true, paused, results })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
