// Agent activity is sourced from the agent_runs table.
import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream third-party payloads are untyped JSON; readers below null-check every field
import { fetchJsonOrThrow } from '@/lib/fetch-json'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createAdminClient } from '@/lib/hub-client'
import { dbStatusMessage, isDbConfigured } from '@/lib/db'
import { firstExistingPath, isDarwin, isWindows } from '@/lib/paths'

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || ''
const N8N_KEY = process.env.N8N_API_KEY || ''
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN || ''
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''

const NO_KEY_ERROR = () => `${dbStatusMessage()} — agent activity and usage unavailable`

// ── Service status vocabulary (TOD: kill-fake-infra-greens) ────────────────
// A tile is 'ok' only if this request actually measured it and it answered
// well. Everything else is honest about what it is: 'degraded' (measured,
// answered, but not clean), 'down' (measured, failed to answer), or
// 'unknown' (never checked — no credential configured on this host, or no
// probe exists for it here). No literal 'ok' is assigned without a probe
// behind it.
type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown'
interface ServiceReading { status: ServiceState; note: string; checkedAt: string }
function reading(status: ServiceState, note: string): ServiceReading {
  return { status, note, checkedAt: new Date().toISOString() }
}

/** Bounded fetch — a hung upstream must not hold the whole probe open. */
async function probe(url: string, init?: RequestInit, timeoutMs = 4000): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    return { ok: r.ok, status: r.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}

async function checkTelegram(): Promise<ServiceReading> {
  if (!TELEGRAM_TOKEN) return reading('unknown', 'no TELEGRAM_BOT_TOKEN configured on this host')
  const r = await probe(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getMe`)
  return r.ok ? reading('ok', 'getMe succeeded') : reading('down', r.error ? `unreachable: ${r.error}` : `getMe returned HTTP ${r.status}`)
}

async function checkDiscord(): Promise<ServiceReading> {
  if (!DISCORD_TOKEN) return reading('unknown', 'no DISCORD_BOT_TOKEN configured on this host')
  const r = await probe('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } })
  return r.ok ? reading('ok', 'bot identity confirmed') : reading('down', r.error ? `unreachable: ${r.error}` : `users/@me returned HTTP ${r.status}`)
}

async function checkGithub(): Promise<ServiceReading> {
  if (!GITHUB_TOKEN) return reading('unknown', 'no GITHUB_TOKEN configured on this host')
  const r = await probe('https://api.github.com/rate_limit', {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'todero-status-probe' },
  })
  return r.ok ? reading('ok', 'token authenticated') : reading('down', r.error ? `unreachable: ${r.error}` : `rate_limit returned HTTP ${r.status}`)
}

async function checkSupabase(): Promise<ServiceReading> {
  if (!isDbConfigured()) return reading('unknown', dbStatusMessage())
  try {
    const { error } = await createAdminClient().from('issues').select('id').limit(1)
    if (error) return reading('down', `query failed: ${error.message}`)
    return reading('ok', 'reachable — issues table queried')
  } catch (e) {
    return reading('down', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Where the Vercel CLI keeps its auth token. The CLI uses xdg-app-paths, so the
 * directory differs per OS - there is no single literal to read. VERCEL_TOKEN
 * short-circuits the lookup entirely on hosts with no CLI installed.
 */
function vercelAuthPath(): string | null {
  const home = os.homedir()
  const candidates: Array<string | undefined> = [
    process.env.VERCEL_AUTH_FILE,
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, 'com.vercel.cli', 'auth.json')
      : undefined,
  ]
  if (isDarwin) {
    candidates.push(path.join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'))
  } else if (isWindows) {
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'com.vercel.cli', 'auth.json'))
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'com.vercel.cli', 'auth.json'))
  } else {
    candidates.push(path.join(home, '.config', 'com.vercel.cli', 'auth.json'))
  }
  return firstExistingPath(candidates)
}

function getVercelToken(): string | null {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN
  const authPath = vercelAuthPath()
  if (!authPath) return null
  try {
    const raw = fs.readFileSync(authPath, 'utf-8')
    const data = JSON.parse(raw)
    if (data.token) return data.token
    if (data.tokens && typeof data.tokens === 'object') {
      const vals = Object.values(data.tokens)
      if (vals.length > 0) return vals[0] as string
    }
    return null
  } catch { return null }
}

export async function GET() {
  const vercelToken = getVercelToken()
  const [openrouter, ollama, n8n, vercel, telegramReading, discordReading, githubReading, supabaseReading] = await Promise.allSettled([
    // OpenRouter
    // TOD-654: fetchJsonOrThrow rejects on a non-ok upstream, so the
    // `status === 'fulfilled'` checks below cannot mistake a 401 error body
    // for a real reading.
    fetchJsonOrThrow<any>('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
      cache: 'no-store',
    }),

    // Ollama
    fetchJsonOrThrow<any>('http://localhost:11434/api/tags', { cache: 'no-store' }),

    // n8n — retired but kept for backwards compat; will always fail
    N8N_KEY ? fetchJsonOrThrow<any>('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
      cache: 'no-store',
    }) : Promise.reject('n8n retired'),

    // Vercel
    (async () => {
      if (!vercelToken) throw new Error('No Vercel token')
      const r = await fetch(
        'https://api.vercel.com/v6/deployments?app=vespera&limit=1&teamId=team_BPpNtsCP3vmSt4R0r8MXbxiJ',
        { headers: { Authorization: `Bearer ${vercelToken}` }, cache: 'no-store' }
      )
      return r.json()
    })(),

    // TOD: kill-fake-infra-greens — every tile below is a real probe, not a literal.
    checkTelegram(),
    checkDiscord(),
    checkGithub(),
    checkSupabase(),
  ])

  // TOD: kill-fake-infra-greens — there used to be a hardcoded
  // `gateway: { running: true }` here. Nothing on this host probes a
  // "gateway", so there is no reading to report; the key is gone rather
  // than asserting a state nobody measured.
  const result: any = {}

  // ── OpenRouter ──
  if (openrouter.status === 'fulfilled' && openrouter.value?.data) {
    const d = openrouter.value.data
    // TOD: kill-fake-infra-greens — OpenRouter returns limit:null for any
    // pay-as-you-go key (the common case). `?? 10` invented a fabricated
    // $10.00 ceiling for exactly that key, which is how this route used to
    // manufacture "$9.57 / $10.00" out of thin air. A missing limit means
    // no limit is set, not "$10", so it stays null all the way to the UI.
    const limit: number | null = typeof d.limit === 'number' ? d.limit : null
    const used = d.usage ?? 0
    result.openrouter = {
      used: +used.toFixed(3),
      limit,
      remaining: limit === null ? null : +(limit - used).toFixed(3),
    }
  } else {
    result.openrouter = null
  }

  // ── Ollama ──
  if (ollama.status === 'fulfilled' && ollama.value?.models) {
    result.ollama = { running: true, models: ollama.value.models.map((m: any) => m.name) }
  } else {
    result.ollama = { running: false, models: [] }
  }

  // ── n8n — retired ──
  if (n8n.status === 'fulfilled') {
    const workflows: any[] = n8n.value?.data ?? n8n.value ?? []
    const active = workflows.filter((w: any) => w.active).length
    result.n8n = { running: true, activeWorkflows: active, totalWorkflows: workflows.length }
  } else {
    result.n8n = { running: false, activeWorkflows: 0, totalWorkflows: 0 }
  }

  // ── Vercel ──
  if (vercel.status === 'fulfilled' && vercel.value?.deployments?.length) {
    const d = vercel.value.deployments[0]
    result.vercel = {
      lastDeploy: {
        status: d.state || d.readyState || 'UNKNOWN',
        url: d.url || '',
        createdAt: d.createdAt || d.created || 0,
        commitSha: d.meta?.githubCommitSha || d.gitSource?.sha || '',
        branch: d.meta?.githubCommitRef || d.gitSource?.ref || '',
      },
    }
  } else {
    result.vercel = null
  }

  result.channels = {
    telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    discord: !!process.env.DISCORD_BOT_TOKEN,
  }
  result.heartbeats = []

  // ── Service tiles (TOD: kill-fake-infra-greens) ──
  // Every reading here comes from a probe run in this same request, or is
  // explicitly 'unknown' when no probe exists / no credential is configured
  // on this host. None of these are literals — the Infra tab renders exactly
  // this object, so a false 'ok' here would be a false 'ok' on screen.
  result.services = {
    // Claude Code's OAuth session lives in the CLI's local credential store,
    // never in an env var this server process can read — so this tile is
    // always 'unknown' here, honestly, not a guess dressed as 'ok'.
    claude: reading('unknown', 'Claude session state is local to the CLI and not exposed to this server'),

    openrouter: !OPENROUTER_KEY
      ? reading('unknown', 'no OPENROUTER_API_KEY configured on this host')
      : result.openrouter
        ? reading(
            'ok',
            result.openrouter.limit === null
              ? `$${result.openrouter.used.toFixed(2)} used · no credit limit set on this key`
              : `$${result.openrouter.remaining.toFixed(2)} of $${result.openrouter.limit.toFixed(2)} remaining`
          )
        : reading('down', 'key configured but the balance check failed'),

    telegram: telegramReading.status === 'fulfilled' ? telegramReading.value : reading('unknown', 'probe did not run'),
    discord: discordReading.status === 'fulfilled' ? discordReading.value : reading('unknown', 'probe did not run'),

    ollama: result.ollama.running
      ? reading(result.ollama.models.length > 0 ? 'ok' : 'degraded', result.ollama.models.length ? result.ollama.models.join(', ') : 'reachable but no models pulled')
      : reading('down', 'not reachable at localhost:11434'),

    vercel: !vercelToken
      ? reading('unknown', 'no Vercel token found for this host')
      : result.vercel
        ? reading(
            result.vercel.lastDeploy.status === 'READY' ? 'ok' : result.vercel.lastDeploy.status === 'ERROR' ? 'down' : 'degraded',
            `${result.vercel.lastDeploy.status}${result.vercel.lastDeploy.branch ? ' · ' + result.vercel.lastDeploy.branch : ''}`,
          )
        : reading('down', 'token present but the deployments fetch failed'),

    supabase: supabaseReading.status === 'fulfilled' ? supabaseReading.value : reading('unknown', 'probe did not run'),
    github: githubReading.status === 'fulfilled' ? githubReading.value : reading('unknown', 'probe did not run'),

    // Neither has an env var anywhere in this repo's config surface — there is
    // nothing on this host to probe, so 'unknown' is the whole truth.
    braveSearch: reading('unknown', 'no Brave Search API key configured on this host'),
    cloudflare: reading('unknown', 'no tunnel health endpoint configured on this host'),
  }

  // ── Rollup (TOD: kill-fake-infra-greens) ──
  // The single source every other service indicator in the app must read
  // instead of inventing its own "All nominal" — the sidebar pill, Overview's
  // subscriptions panel, and AI Services all derive from this, not from a
  // literal. `overall` is 'unknown' whenever nothing on this host has been
  // confirmed ok — never a default of ok.
  {
    const readings = Object.values(result.services) as ServiceReading[]
    const down = readings.filter(r => r.status === 'down').length
    const degraded = readings.filter(r => r.status === 'degraded').length
    const unknown = readings.filter(r => r.status === 'unknown').length
    const ok = readings.filter(r => r.status === 'ok').length
    const overall: ServiceState = down > 0 ? 'down' : degraded > 0 ? 'degraded' : ok > 0 ? 'ok' : 'unknown'
    result.rollup = { ok, down, degraded, unknown, total: readings.length, overall }
  }

  // ── Agent activity from agent_runs ──
  // A host with no Supabase key cannot know any of this. Saying so beats
  // rendering an empty activity feed that reads as "nothing happened today".
  let activityError: string | null = isDbConfigured() ? null : NO_KEY_ERROR()
  try {
    if (activityError) throw new Error(activityError)
    const db = createAdminClient()
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { data: runs } = await db
      .from('agent_runs')
      .select('agent_id, task_title, status, started_at, finished_at, tokens_used, cost_usd')
      .gte('started_at', cutoff)
      .order('started_at', { ascending: false })
      .limit(50)

    const AGENT_EMOJIS: Record<string, string> = {
      builder: '🔨', po: '📋', tester: '🧪', ops: '⚙️', deployer: '🚀',
      auditor: '🔍', main: '🧠', scout: '🔍'
    }
    const agentCurrentTask: Record<string, string> = {}
    const seen = new Set<string>()
    const allActivity: any[] = []

    for (const r of runs ?? []) {
      const agoMin = r.started_at
        ? Math.floor((Date.now() - new Date(r.started_at).getTime()) / 60000)
        : 999
      if (!seen.has(r.agent_id)) {
        seen.add(r.agent_id)
        const label = (r.task_title || 'Task').slice(0, 48)
        agentCurrentTask[r.agent_id] = r.status === 'running'
          ? `Working: ${label}`
          : agoMin < 30 ? `Completed: ${label} (${agoMin}m ago)` : `Idle · last ${agoMin}m ago`
      }
      allActivity.push({
        agentId: r.agent_id,
        agentName: r.agent_id,
        emoji: AGENT_EMOJIS[r.agent_id] ?? '🤖',
        action: 'run',
        desc: `${r.task_title ?? 'Task'} · ${r.status}`,
        tokens: r.tokens_used ?? 0,
        cost: r.cost_usd ?? 0,
        updatedAt: r.started_at ? new Date(r.started_at).getTime() : 0,
        ago: agoMin,
        startedAt: r.started_at ? new Date(r.started_at).getTime() : 0,
      })
    }

    result.recentActivity = allActivity.slice(0, 20)
    result.agentCurrentTask = agentCurrentTask

    // ── Usage summary from agent_runs (TOD: kill-fake-infra-greens) ──
    // totalCost/totalTokens used to be literal 0s, rendered on the Infra tab
    // as a confident "ALL-TIME $0.00" figure that nothing computed. This now
    // sums every row on this host, real number or real zero — never a
    // constant standing in for a number that was never added up.
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: allRuns } = await db
      .from('agent_runs')
      .select('tokens_used, cost_usd, started_at')
    let totalCost = 0, totalTokens = 0, todayCost = 0, todayTokens = 0
    for (const r of allRuns ?? []) {
      const cost = r.cost_usd ?? 0
      const tok = r.tokens_used ?? 0
      totalCost += cost
      totalTokens += tok
      if (r.started_at && new Date(r.started_at) >= todayStart) {
        todayCost += cost
        todayTokens += tok
      }
    }
    result.usage = {
      totalCost: +totalCost.toFixed(4),
      totalTokens,
      byModel: {},
      todayCost: +todayCost.toFixed(4),
      todayTokens,
    }
    // TOD: kill-fake-infra-greens — no `plan` field: this server cannot read
    // the Claude CLI's local OAuth session, so asserting 'Max' was a guess.
    // services.claude (above) is the honest reading for Claude's connection
    // state; this object is only ever the token/cost rollup.
    result.claude = { lastChecked: new Date().toISOString(), totalTokens, todayCost }
  } catch (e) {
    // Never swallow the reason — an unreachable database is not "no activity".
    activityError = e instanceof Error ? e.message : String(e)
    result.recentActivity = []
    result.agentCurrentTask = {}
    result.usage = null
    result.claude = null
  }

  // ── Host snapshot — replaces the InfraTab's old hardcoded "Mac mini ·
  // Apple Silicon" card, which kept claiming Apple hardware on every host
  // it ran on, Windows included. This is read from the running process.
  result.system = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
    nodeVersion: process.version,
    uptimeSec: Math.round(os.uptime()),
  }

  result.configured = activityError === null
  result.error = activityError

  return NextResponse.json(result, {
    status: activityError ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
