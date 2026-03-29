import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execAsync = promisify(exec)
const N8N_KEY = 'n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac'
const OC_CRONS_PATH = '/Users/kemuniagent/.openclaw/cron/jobs.json'

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
      // Fetch last execution for each workflow in parallel
      const execResults = await Promise.allSettled(
        workflows.map(w =>
          fetch(`http://localhost:5678/api/v1/executions?workflowId=${w.id}&limit=1&includeData=false`, {
            headers: { 'X-N8N-API-KEY': N8N_KEY }, cache: 'no-store'
          }).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      )
      for (let i = 0; i < workflows.length; i++) {
        const w = workflows[i]
        const triggerNode = (w.nodes ?? []).find((n: any) =>
          n.type === 'n8n-nodes-base.scheduleTrigger' || n.type?.includes('cron') || n.type?.includes('schedule')
        )
        const rule = triggerNode?.parameters?.rule ?? triggerNode?.parameters ?? {}
        const cronExpr = rule?.interval?.[0]?.expression ?? null
        const hour = rule.hour ?? rule.atHour ?? 9
        const min = rule.minute ?? rule.atMinute ?? 0
        const time = cronExpr ? cronExpr : `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}`
        // Last execution
        const execResult = execResults[i]
        const execData = execResult.status === 'fulfilled' ? (execResult as PromiseFulfilledResult<any>).value : null
        const lastExec = execData?.data?.[0] ?? null
        const lastRunStatus = lastExec ? (lastExec.status === 'success' ? 'ok' : 'error') : null
        const lastRunAtMs = lastExec?.startedAt ? new Date(lastExec.startedAt).getTime() : null
        results.push({
          id: w.name.toLowerCase().replace(/\s+/g, '-'),
          name: w.name,
          time,
          hour: typeof hour === 'number' ? hour : 9,
          min: typeof min === 'number' ? min : 0,
          days: 'daily',
          model: 'n8n',
          project: 'Ops',
          status: w.active ? (lastRunStatus === 'error' ? 'error' : 'active') : 'planned',
          desc: w.name,
          source: 'n8n',
          lastRunStatus,
          lastRunAtMs,
          n8nWorkflowId: w.id,
        })
      }
    }
  } catch { /* n8n unavailable */ }

  // ── OpenClaw scheduled crons (from cron/jobs.json) ──
  try {
    const raw = JSON.parse(fs.readFileSync(OC_CRONS_PATH, 'utf-8'))
    const jobs: any[] = raw.jobs ?? []
    for (const job of jobs) {
      const sched = job.schedule ?? {}
      let time = '—'
      let hour: number | null = null
      let min: number | null = null
      let days = 'daily'
      if (sched.kind === 'cron' && sched.expr) {
        const parts = sched.expr.split(' ')
        // standard cron: min hour dom month dow
        const m = parseInt(parts[0])
        const h = parseInt(parts[1])
        if (!isNaN(h) && !isNaN(m)) {
          hour = h; min = m
          time = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
          // dow: 1-5 = weekdays, * = daily, 1 = Mon etc.
          const dow = parts[4]
          days = dow === '*' ? 'daily' : dow === '1-5' ? 'weekdays' : dow === '1' ? 'Mon' : `dow:${dow}`
        }
      } else if (sched.kind === 'every') {
        const mins = Math.round((sched.everyMs ?? 3600000) / 60000)
        time = `every ${mins}m`
        days = 'interval'
      }
      const project = job.name?.toLowerCase().includes('vespera') ? 'Vespera'
        : job.name?.toLowerCase().includes('kemuni') ? 'Kemuni'
        : job.name?.toLowerCase().includes('billing') ? 'Ops'
        : job.agentId?.includes('vespera') ? 'Vespera'
        : job.agentId?.includes('kemuni') ? 'Kemuni' : 'Ops'
      const lastStatus = job.state?.lastRunStatus ?? null
      results.push({
        id: job.id,
        name: job.name || job.id,
        time,
        hour,
        min,
        days,
        model: job.payload?.model?.includes('haiku') ? 'Haiku' : job.payload?.model?.includes('sonnet') ? 'Sonnet' : job.payload?.kind === 'agentTurn' ? 'Sonnet' : 'Agent',
        project,
        status: job.enabled ? (lastStatus === 'error' ? 'error' : 'active') : 'planned',
        desc: job.name || job.id,
        source: 'openclaw-cron',
        ocJobId: job.id,
        sessionTarget: job.sessionTarget,
        lastRunStatus: lastStatus,
        lastRunAtMs: job.state?.lastRunAtMs ?? null,
        consecutiveErrors: job.state?.consecutiveErrors ?? 0,
        enabled: job.enabled,
      })
    }
  } catch { /* crons file unavailable */ }

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
