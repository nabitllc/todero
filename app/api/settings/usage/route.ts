import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream third-party payloads are untyped JSON; readers below null-check every field
import { fetchJsonOrThrow } from '@/lib/fetch-json'
import { promisify } from 'util'
import fs from 'fs'
import { db, isDbConfigured } from '@/lib/db'

const promisifyExec = promisify

/** Configuration, not a constant. An absent key simply means "no balance shown". */
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''

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

/** Database size in bytes, or null when unavailable. Never throws. */
async function dbSizeBytes(): Promise<number | null> {
  if (!isDbConfigured()) return null
  try {
    const { data, error } = await db().rpc('pg_database_size_bytes')
    if (error) return null
    return typeof data === 'number' ? data : null
  } catch {
    return null
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const [supabaseDb, openrouter, cfKaos, discordBot] = await Promise.allSettled([
    // 1. Database size, through the seam's stored-procedure call.
    // TOD-654: an upstream failure resolves to null rather than an error body,
    // which the readers below would otherwise treat as a real number.
    dbSizeBytes(),

    // 2. OpenRouter balance — skipped when no key is configured.
    OPENROUTER_KEY
      ? fetchJsonOrThrow<any>('https://openrouter.ai/api/v1/auth/key', {
          headers: { Authorization: `Bearer ${OPENROUTER_KEY}` },
          cache: 'no-store',
        })
      : Promise.resolve(null),

    // 3. Cloudflare tunnel - kaos.nabit.work
    fetch('https://kaos.nabit.work', {
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    }).then(r => ({ ok: r.status < 400 || r.status === 307, status: r.status }))
      .catch(() => ({ ok: false, status: 0 })),

    // 4. Discord bot status
    fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || ''}` },
      cache: 'no-store',
    }).then(r => ({ connected: r.ok })).catch(() => ({ connected: false })),
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

  // --- Cloudflare tunnels ---
  const cloudflare = {
    kaos: { up: cfKaos.status === 'fulfilled' ? (cfKaos.value as any).ok : false, lastChecked: now },
  }

  // --- Discord ---
  const discord = {
    connected: discordBot.status === 'fulfilled' ? (discordBot.value as any).connected : false,
    lastChecked: now,
  }

  // --- Claude tokens (from agent_runs) ---
  const claude: any = { totalTokens: 0, todayCost: 0, plan: 'Max $200/mo', lastChecked: now }

  // --- Vercel (static) ---
  const vercel = { plan: 'Pro $20/mo', seats: 1, renewsAt: '2026-04-24', lastChecked: now }

  const data = { supabase, openrouter: openrouterResult, cloudflare, discord, claude, vercel }
  cache = { data, ts: Date.now() }
  return NextResponse.json(data)
}
