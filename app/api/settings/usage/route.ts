import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'

const execAsync = promisify(exec)

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const OPENROUTER_KEY = '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'
const N8N_KEY = 'n8n_api_34e5ba0e4da8b759e75b310a8c014c4de0275375eba302bdf87d2e7e6dd2adac'

let cache: { data: any; ts: number } | null = null
const CACHE_TTL = 30_000

function getSessionCosts(sessionsPaths: string[]) {
  let totalTokens = 0, todayCost = 0
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  for (const p of sessionsPaths) {
    try {
      if (!fs.existsSync(p)) continue
      const stat = fs.statSync(p)
      const isToday = stat.mtimeMs >= todayStart
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const items = typeof raw === 'object' && !Array.isArray(raw) ? Object.values(raw) : (Array.isArray(raw) ? raw : [])
      for (const item of items as any[]) {
        totalTokens += item?.totalTokens ?? 0
        if (isToday) todayCost += item?.estimatedCostUsd ?? 0
      }
    } catch { /* skip */ }
  }
  return { totalTokens, todayCost: +todayCost.toFixed(4) }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const [supabaseDb, openrouter, n8nRes, cfKaos, cfN8n, discordBot, ocStatus] = await Promise.allSettled([
    // 1. Supabase DB size via REST RPC
    fetch(`${SUPABASE_URL}/rest/v1/rpc/pg_database_size_bytes`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      cache: 'no-store',
    }).then(r => r.json()).catch(() => null),

    // 2. OpenRouter balance
    fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
      cache: 'no-store',
    }).then(r => r.json()),

    // 3. n8n workflows
    fetch('http://localhost:5678/api/v1/workflows', {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
      cache: 'no-store',
    }).then(r => r.json()),

    // 4. Cloudflare tunnel - kaos.nabit.work
    fetch('https://kaos.nabit.work', {
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    }).then(r => ({ ok: r.status < 400 || r.status === 307, status: r.status }))
      .catch(() => ({ ok: false, status: 0 })),

    // 5. Cloudflare tunnel - n8n.nabit.work
    fetch('https://n8n.nabit.work', {
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    }).then(r => ({ ok: r.status < 400 || r.status === 307, status: r.status }))
      .catch(() => ({ ok: false, status: 0 })),

    // 6. Discord bot status
    fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || ''}` },
      cache: 'no-store',
    }).then(r => ({ connected: r.ok })).catch(() => ({ connected: false })),

    // 7. OpenClaw status
    execAsync('/opt/homebrew/bin/openclaw status --json', { timeout: 8000 }).then(r => JSON.parse(r.stdout)).catch(() => null),
  ])

  const now = new Date().toISOString()

  // --- Supabase ---
  let supabase: any = { dbBytes: null, dbLimitBytes: 500 * 1024 * 1024, plan: 'Free Tier', lastChecked: now }
  if (supabaseDb.status === 'fulfilled' && typeof supabaseDb.value === 'number') {
    supabase.dbBytes = supabaseDb.value
  }

  // --- OpenRouter ---
  let openrouterResult: any = { balance: null, limit: null, used: null, isFreeTier: false, lastChecked: now }
  if (openrouter.status === 'fulfilled' && openrouter.value?.data) {
    const d = openrouter.value.data
    openrouterResult = {
      balance: d.limit != null && d.usage != null ? +(d.limit - d.usage).toFixed(2) : null,
      limit: d.limit ?? null,
      used: d.usage ? +d.usage.toFixed(2) : null,
      isFreeTier: d.is_free_tier ?? false,
      lastChecked: now,
    }
  }

  // --- n8n ---
  let n8n: any = { running: false, activeWorkflows: 0, totalWorkflows: 0, plan: 'Self-hosted', lastChecked: now }
  if (n8nRes.status === 'fulfilled') {
    const workflows: any[] = n8nRes.value?.data ?? n8nRes.value ?? []
    n8n = { running: true, activeWorkflows: workflows.filter((w: any) => w.active).length, totalWorkflows: workflows.length, plan: 'Self-hosted', lastChecked: now }
  }

  // --- Cloudflare tunnels ---
  const cloudflare = {
    kaos: { up: cfKaos.status === 'fulfilled' ? (cfKaos.value as any).ok : false, lastChecked: now },
    n8n: { up: cfN8n.status === 'fulfilled' ? (cfN8n.value as any).ok : false, lastChecked: now },
  }

  // --- Discord ---
  const discord = {
    connected: discordBot.status === 'fulfilled' ? (discordBot.value as any).connected : false,
    lastChecked: now,
  }

  // --- Claude / OpenClaw tokens ---
  let claude: any = { totalTokens: 0, todayCost: 0, plan: 'Max $200/mo', lastChecked: now }
  if (ocStatus.status === 'fulfilled' && ocStatus.value) {
    const sessionPaths: string[] = ocStatus.value.sessions?.paths ?? []
    const costs = getSessionCosts(sessionPaths)
    claude = { totalTokens: costs.totalTokens, todayCost: costs.todayCost, plan: 'Max $200/mo', lastChecked: now }
  }

  // --- Vercel (static) ---
  const vercel = { plan: 'Pro $20/mo', seats: 1, renewsAt: '2026-04-24', lastChecked: now }

  const data = { supabase, openrouter: openrouterResult, n8n, cloudflare, discord, claude, vercel }
  cache = { data, ts: Date.now() }
  return NextResponse.json(data)
}
