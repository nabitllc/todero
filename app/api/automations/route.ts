// Automations data — Vercel crons + LaunchAgents + recent agent_runs.
//
// TOD: this surface must never assert a schedule it did not actually read.
// The UI (AutomationsTab, CalendarTab) is only allowed to show a live
// countdown for an item that carries a real `nextRunAtMs`, which this route
// only sets when it parsed an actual cron expression. Everything else gets
// `nextRunAtMs: null` and the UI must render that as "no computable next
// run", never fabricate one.
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { createAdminClient } from '@/lib/hub-client'
import { dbStatusMessage, isDbConfigured } from '@/lib/db'
import { isDarwin } from '@/lib/paths'

const NO_KEY_ERROR = () => `${dbStatusMessage()} — automation run history unavailable`

type Source = 'vercel-cron' | 'launchagent'

interface AutomationItem {
  id: string
  name: string
  // Single-project simplification (owner directive, 2026-08-24): Todero is
  // one project for now, so every automation belongs to it. Revisit if/when
  // multi-project comes back — don't invent per-job project attribution
  // before then.
  project: 'Todero'
  time: string
  days: string
  source: Source
  /**
   * 'active'/'error' only ever apply when `scheduled` is true — this route
   * must never say "active" about a job whose scheduler it did not confirm
   * is live on THIS host. 'declared' means "the config says this should
   * exist" with no proof anything will fire it.
   */
  status: 'active' | 'planned' | 'error' | 'declared'
  desc: string
  /** Raw schedule expression, when one was actually read (cron syntax). Null = unknown. */
  schedule: string | null
  /** Epoch ms of the next scheduled fire, ONLY when computed from a real `schedule`. Null = no countdown should render. */
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastRunStatus: string | null
  /**
   * True only when THIS process proved a scheduler for this item is live on
   * THIS host — not merely that the item is declared somewhere on disk.
   * vercel-cron: true only when `process.env.VERCEL` is set (Vercel actually
   * runs crons; `next dev` on a laptop does not). launchagent: true only
   * when `launchctl list <label>` reports the label loaded. The UI must
   * gate every "active"/countdown affordance on this field, not on `status`.
   */
  scheduled: boolean
  /** One-line account of what was checked to decide `scheduled`, shown verbatim in the UI. */
  schedulerEvidence: string
}

/**
 * Same envelope contract as /api/files and /api/agents: a host that cannot
 * answer says so with `configured:false` + a reason and a 503, instead of
 * returning an empty list that reads as "you have no automations".
 * `warnings` covers sources that are legitimately absent (no vercel.json on
 * this checkout) rather than broken.
 *
 * `source`/`scheduler` (TOD, kill-fake-automations): every reader — human or
 * check script — must be able to tell whether a job list is real without
 * inspecting each row. `source` is the aggregate provenance of `automations`
 * ('none' when empty); `scheduler` is a one-line human explanation of what
 * was actually checked on this host, so an empty list says WHY.
 */
type AutomationsResponse = {
  automations: AutomationItem[]
  configured: boolean
  error: string | null
  warnings: string[]
  source: Source | 'mixed' | 'none'
  scheduler: string
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
  if (min.startsWith('*/') && hour === '*') return `every ${min.slice(2)}min`
  if (!isNaN(Number(min)) && !isNaN(Number(hour))) {
    return `${String(Number(hour)).padStart(2,'0')}:${String(Number(min)).padStart(2,'0')}`
  }
  return expr
}

// Computes the next fire time for the small set of 5-field cron patterns we
// can resolve unambiguously: "every N minutes" (step on the minute field,
// wildcard elsewhere) and fixed daily/weekly HH:MM. Anything else — step
// values on hour/day/month, lists, ranges — returns null rather than guess,
// because a wrong countdown is worse than none.
//
// Vercel crons are specified and executed in UTC (Vercel's own docs: "cron
// expressions ... are evaluated in the UTC time zone"), so the fixed HH:MM
// branch below computes against UTC fields, never the host's local clock —
// a Windows dev box's local time zone has nothing to do with when Vercel's
// scheduler would actually fire this.
function nextCronRun(expr: string, from: Date = new Date()): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minField, hourField, domField, monField, dowField] = parts

  const everyMin = minField.match(/^\*\/(\d+)$/)
  if (everyMin && hourField === '*' && domField === '*' && monField === '*' && dowField === '*') {
    const n = Number(everyMin[1])
    if (!n || n <= 0) return null
    const stepMs = n * 60000
    return (Math.floor(from.getTime() / stepMs) + 1) * stepMs
  }

  if (/^\d+$/.test(minField) && /^\d+$/.test(hourField) && domField === '*' && monField === '*') {
    const min = Number(minField)
    const hour = Number(hourField)
    if (min > 59 || hour > 23) return null
    const next = new Date(from)
    next.setUTCSeconds(0, 0)
    next.setUTCHours(hour, min, 0, 0)
    if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1)
    if (dowField !== '*') {
      const targetDow = Number(dowField)
      if (isNaN(targetDow) || targetDow < 0 || targetDow > 6) return null
      for (let i = 0; i < 7 && next.getUTCDay() !== targetDow; i++) next.setUTCDate(next.getUTCDate() + 1)
    }
    return next.getTime()
  }

  return null
}

function parsePlistLabel(label: string): string {
  // work.nabit.agent-kicker → agent-kicker
  return label.replace(/^work\.nabit\./, '')
}

/**
 * True only when `launchctl list <label>` reports the label as currently
 * loaded in this user's launchd session — i.e. macOS itself will fire it.
 * A plist sitting in ~/Library/LaunchAgents that was never `launchctl load`ed
 * (or was unloaded) is not evidence of anything running; `launchctl list`
 * exits non-zero when the label isn't loaded, so a non-zero exit is a normal,
 * tolerated "not scheduled" answer, not a failure to swallow.
 */
function checkLaunchdLoaded(label: string): boolean {
  if (!isDarwin) return false
  try {
    const result = spawnSync('launchctl', ['list', label], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 3000,
    })
    // launchctl exits non-zero (and prints "Could not find service") when the
    // label is not loaded — that's expected, not an error to bail out on.
    return typeof result.stdout === 'string' && result.stdout.includes(label)
  } catch {
    // spawn itself failed (launchctl missing, timed out) — treat as unproven.
    return false
  }
}

export async function GET() {
  const results: AutomationItem[] = []
  const warnings: string[] = []
  const schedulerParts: string[] = []
  let fatal: string | null = null
  const now = new Date()

  // ── Vercel crons from vercel.json ─────────────────────────────────────────
  // Declaring a cron in vercel.json only means Vercel WILL run it on a Vercel
  // deployment. This route can run in that deployment (process.env.VERCEL is
  // set by Vercel's build/runtime images) or in `next dev` on someone's
  // laptop, which vercel.json knows nothing about and which no scheduler on
  // this host will ever fire. Only the former counts as `scheduled`.
  const vercelIsRunningHere = Boolean(process.env.VERCEL)
  const vercelEvidence = vercelIsRunningHere
    ? 'process.env.VERCEL is set — this process is a Vercel deployment'
    : 'declared in vercel.json; this process is not a Vercel deployment'
  try {
    const vercelPath = path.join(process.cwd(), 'vercel.json')
    const vercelJson = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'))
    const crons: Array<{ path: string; schedule: string }> = vercelJson.crons ?? []
    schedulerParts.push(crons.length > 0 ? `vercel.json (${crons.length} cron${crons.length === 1 ? '' : 's'})` : 'vercel.json (declares none)')
    for (const cron of crons) {
      const name = cron.path.replace('/api/cron/', '')
      results.push({
        id: `vercel-${name}`,
        name,
        project: 'Todero',
        time: parseCronToTime(cron.schedule),
        days: 'interval',
        source: 'vercel-cron',
        status: vercelIsRunningHere ? 'active' : 'declared',
        desc: `Vercel cron: ${cron.path}`,
        schedule: cron.schedule,
        nextRunAtMs: vercelIsRunningHere ? nextCronRun(cron.schedule, now) : null,
        lastRunAtMs: null,
        lastRunStatus: null,
        scheduled: vercelIsRunningHere,
        schedulerEvidence: vercelEvidence,
      })
    }
  } catch (e) {
    // No vercel.json is a real answer ("this checkout declares no crons").
    // A vercel.json that exists but cannot be read/parsed is not — reporting
    // an empty list there would be a lie about what is scheduled.
    if (isMissingFile(e)) {
      warnings.push('No vercel.json in this checkout — no Vercel crons declared.')
      schedulerParts.push('vercel.json (absent)')
    } else {
      fatal = `vercel.json could not be read: ${message(e)}`
    }
  }

  // ── LaunchAgents from ~/Library/LaunchAgents/ ─────────────────────────────
  // launchd is macOS-only. On Linux/Windows there is nothing to enumerate, so
  // skip the read entirely instead of relying on readdirSync throwing ENOENT.
  if (isDarwin) {
    try {
      const laDir = path.join(homedir(), 'Library', 'LaunchAgents')
      const files = fs.readdirSync(laDir).filter(f => f.startsWith('work.nabit.') && f.endsWith('.plist'))
      schedulerParts.push(`launchd (${files.length} plist${files.length === 1 ? '' : 's'})`)
      for (const file of files) {
        const label = file.replace('.plist', '')
        const name = parsePlistLabel(label)
        // A plist file on disk is a declaration, not a promise — launchd only
        // acts on labels it has actually loaded. Ask it directly rather than
        // inferring "active" from the file existing.
        const loaded = checkLaunchdLoaded(label)
        results.push({
          id: `la-${name}`,
          name,
          project: 'Todero',
          time: '—',
          days: 'scheduled',
          source: 'launchagent',
          status: loaded ? 'active' : 'declared',
          desc: `LaunchAgent: ${label}`,
          // We enumerate the plist but do not parse its StartCalendarInterval,
          // so we genuinely don't know the schedule — no fabricated time, no countdown.
          schedule: null,
          nextRunAtMs: null,
          lastRunAtMs: null,
          lastRunStatus: null,
          scheduled: loaded,
          schedulerEvidence: loaded
            ? `launchctl list ${label} — loaded in launchd`
            : 'plist on disk, not loaded in launchd',
        })
      }
    } catch (e) {
      warnings.push(`LaunchAgents directory unreadable: ${message(e)}`)
      schedulerParts.push('launchd (unreadable)')
    }
  } else {
    schedulerParts.push('launchd unavailable (host is not macOS)')
  }

  // ── Recent agent_runs — enrich with last run data ─────────────────────────
  if (!isDbConfigured()) {
    fatal = fatal ?? NO_KEY_ERROR()
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

  const distinctSources = Array.from(new Set(results.map(r => r.source)))
  const source: AutomationsResponse['source'] =
    distinctSources.length === 0 ? 'none' : distinctSources.length === 1 ? distinctSources[0] : 'mixed'
  const scheduler = schedulerParts.join('; ')

  const body: AutomationsResponse = {
    automations: results,
    configured: fatal === null,
    error: fatal,
    warnings,
    source,
    scheduler,
  }
  return NextResponse.json(body, {
    status: fatal ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
