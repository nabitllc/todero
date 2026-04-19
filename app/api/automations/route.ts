// TOD-1.10: Automations data — Vercel crons + LaunchAgents + recent agent_runs
// Replaces dead n8n + openclaw queries (both services retired 2026-04).
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import { createAdminClient } from '@/lib/hub-client'

interface AutomationItem {
  id: string
  name: string
  time: string
  days: string
  source: 'vercel-cron' | 'launchagent'
  status: 'active' | 'planned' | 'error'
  desc: string
  lastRunAtMs: number | null
  lastRunStatus: string | null
}

function parseCronToTime(expr: string): string {
  // Simple cron → human time for common patterns
  const parts = expr.split(' ')
  if (parts.length < 5) return expr
  const min = parts[0]
  const hour = parts[1]
  if (min === '*/30' && hour === '*') return 'every 30min'
  if (!isNaN(Number(min)) && !isNaN(Number(hour))) {
    return `${String(Number(hour)).padStart(2,'0')}:${String(Number(min)).padStart(2,'0')}`
  }
  return expr
}

function parsePlistLabel(label: string): string {
  // work.nabit.agent-kicker → agent-kicker
  return label.replace(/^work\.nabit\./, '')
}

export async function GET() {
  const results: AutomationItem[] = []

  // ── Vercel crons from vercel.json ─────────────────────────────────────────
  try {
    const vercelPath = path.join(process.cwd(), 'vercel.json')
    const vercelJson = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'))
    const crons: Array<{ path: string; schedule: string }> = vercelJson.crons ?? []
    for (const cron of crons) {
      const name = cron.path.replace('/api/cron/', '')
      results.push({
        id: `vercel-${name}`,
        name,
        time: parseCronToTime(cron.schedule),
        days: 'interval',
        source: 'vercel-cron',
        status: 'active',
        desc: `Vercel cron: ${cron.path}`,
        lastRunAtMs: null,
        lastRunStatus: null,
      })
    }
  } catch { /* vercel.json unavailable */ }

  // ── LaunchAgents from ~/Library/LaunchAgents/ ─────────────────────────────
  try {
    const laDir = path.join(homedir(), 'Library', 'LaunchAgents')
    const files = fs.readdirSync(laDir).filter(f => f.startsWith('work.nabit.') && f.endsWith('.plist'))
    for (const file of files) {
      const label = file.replace('.plist', '')
      const name = parsePlistLabel(label)
      results.push({
        id: `la-${name}`,
        name,
        time: '—',
        days: 'scheduled',
        source: 'launchagent',
        status: 'active',
        desc: `LaunchAgent: ${label}`,
        lastRunAtMs: null,
        lastRunStatus: null,
      })
    }
  } catch { /* LaunchAgents dir unavailable */ }

  // ── Recent agent_runs — enrich with last run data ─────────────────────────
  try {
    const db = createAdminClient()
    const { data: runs } = await db
      .from('agent_runs')
      .select('agent_id,status,created_at')
      .order('created_at', { ascending: false })
      .limit(100)

    // Map latest run per agent_id
    const latest: Record<string, { ms: number; status: string }> = {}
    for (const run of runs ?? []) {
      if (!latest[run.agent_id]) {
        latest[run.agent_id] = {
          ms: new Date(run.created_at).getTime(),
          status: run.status,
        }
      }
    }

    // Attach to matching LaunchAgent items
    for (const item of results) {
      if (item.source === 'launchagent') {
        const match = Object.entries(latest).find(([id]) => item.name.includes(id) || id.includes(item.name))
        if (match) {
          item.lastRunAtMs = match[1].ms
          item.lastRunStatus = match[1].status
        }
      }
    }
  } catch { /* agent_runs unavailable */ }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
