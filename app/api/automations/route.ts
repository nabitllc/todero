// Automations data — Vercel crons + LaunchAgents + recent agent_runs.
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import { createAdminClient } from '@/lib/hub-client'
import { isDarwin } from '@/lib/paths'

const NO_KEY_ERROR =
  'SUPABASE_SERVICE_ROLE_KEY is not set — automation run history unavailable'

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

/**
 * Same envelope contract as /api/files and /api/agents: a host that cannot
 * answer says so with `configured:false` + a reason and a 503, instead of
 * returning an empty list that reads as "you have no automations".
 * `warnings` covers sources that are legitimately absent (no vercel.json on
 * this checkout) rather than broken.
 */
type AutomationsResponse = {
  automations: AutomationItem[]
  configured: boolean
  error: string | null
  warnings: string[]
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isMissingFile(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'
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
  const warnings: string[] = []
  let fatal: string | null = null

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
  } catch (e) {
    // No vercel.json is a real answer ("this checkout declares no crons").
    // A vercel.json that exists but cannot be read/parsed is not — reporting
    // an empty list there would be a lie about what is scheduled.
    if (isMissingFile(e)) warnings.push('No vercel.json in this checkout — no Vercel crons declared.')
    else fatal = `vercel.json could not be read: ${message(e)}`
  }

  // ── LaunchAgents from ~/Library/LaunchAgents/ ─────────────────────────────
  // launchd is macOS-only. On Linux/Windows there is nothing to enumerate, so
  // skip the read entirely instead of relying on readdirSync throwing ENOENT.
  if (isDarwin) {
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
    } catch (e) {
      warnings.push(`LaunchAgents directory unreadable: ${message(e)}`)
    }
  }

  // ── Recent agent_runs — enrich with last run data ─────────────────────────
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fatal = fatal ?? NO_KEY_ERROR
  } else {
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
    } catch (e) {
      // Never swallow: "last run unknown" rendered as "never ran" is a lie.
      fatal = fatal ?? `agent_runs unavailable: ${message(e)}`
    }
  }

  const body: AutomationsResponse = {
    automations: results,
    configured: fatal === null,
    error: fatal,
    warnings,
  }
  return NextResponse.json(body, {
    status: fatal ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
