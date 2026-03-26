import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const N8N_KEY = 'n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac'

export async function GET() {
  const results: any[] = []

  // ── n8n workflows (source of truth for scheduled automations) ──
  try {
    const res = await fetch('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
      cache: 'no-store',
    })
    if (res.ok) {
      const data = await res.json()
      const workflows: any[] = data.data ?? []
      for (const w of workflows) {
        const triggerNode = (w.nodes ?? []).find((n: any) =>
          n.type === 'n8n-nodes-base.scheduleTrigger' || n.type?.includes('cron') || n.type?.includes('schedule')
        )
        const rule = triggerNode?.parameters?.rule ?? triggerNode?.parameters ?? {}
        const hour = rule.hour ?? rule.atHour ?? 9
        const min = rule.minute ?? rule.atMinute ?? 0
        const time = `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`
        results.push({
          id: w.name.toLowerCase().replace(/\s+/g, '-'),
          name: w.name,
          time,
          hour: typeof hour === 'number' ? hour : 9,
          min: typeof min === 'number' ? min : 0,
          days: 'daily',
          model: 'n8n',
          project: 'Ops',
          status: w.active ? 'active' : 'planned',
          desc: w.name,
          source: 'n8n',
        })
      }
    }
  } catch { /* n8n unavailable */ }

  // ── OpenClaw heartbeats (from openclaw status --json) ──
  try {
    const { stdout } = await execAsync('/opt/homebrew/bin/openclaw status --json', { timeout: 6000 })
    const oc = JSON.parse(stdout)
    const hbAgents: any[] = oc?.heartbeat?.agents ?? []
    for (const hb of hbAgents) {
      if (!hb.agentId) continue
      results.push({
        id: `heartbeat-${hb.agentId}`,
        name: `${hb.agentId} heartbeat`,
        time: hb.every ?? 'interval',
        hour: null,
        min: null,
        days: 'interval',
        model: hb.agentId === 'ops' ? 'Haiku' : hb.agentId === 'main' ? 'Haiku' : 'Sonnet',
        project: hb.agentId.includes('vespera') ? 'Vespera' : hb.agentId.includes('kemuni') ? 'Kemuni' : 'Ops',
        status: hb.enabled ? 'active' : 'planned',
        desc: `${hb.agentId} — every ${hb.every}`,
        source: 'openclaw',
        agentId: hb.agentId,
        heartbeatEnabled: hb.enabled,
      })
    }
  } catch { /* openclaw unavailable */ }

  // Fallback if both failed
  if (results.length === 0) {
    try {
      const fs = await import('fs')
      const path = await import('path')
      const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'crons.json'), 'utf-8')
      return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
    } catch {
      return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
    }
  }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
