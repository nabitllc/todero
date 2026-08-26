import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream third-party payloads are untyped JSON; readers below null-check every field
import { promisify } from 'util'
import fs from 'fs'
import { db, isDbConfigured } from '@/lib/db'
import { sqlitePath } from '@/lib/db/sqlite-adapter'
import { dbUnavailableResponse } from '@/lib/db-http'
import { LLM_BASE_URL, fetchLiveModels, type LiveModelsFailureKind } from '@/lib/llm-provider'
import { resolveDiscordToken } from '@/lib/discord-sender'

const promisifyExec = promisify

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

/**
 * fetchLiveModels() returns one prose error string shaped differently per
 * failure mode ("<url> is unreachable — <detail>" for a network failure,
 * "<url>/models responded <status>: <text>" for a bad response, and for a
 * wrong-API 200 a multi-sentence explanation that itself contains em-dashes).
 * Pull out just the reason so the card can show `<lead> — <url> — <reason>`
 * without repeating the URL twice. The lead word comes from the seam's own
 * `kind`, NOT from this function — see the GET handler below.
 */
function reasonFrom(url: string, error: string): string {
  // FIRST separator, not the last: everything after the first em-dash is
  // the reason. Only the leading "<url>" / "<url>/models" is redundant.
  //
  // This was `lastIndexOf`, which kept only the text after the FINAL em-dash.
  // The not-openai-compatible message legitimately carries two, so the card
  // reduced the single commonest misconfiguration (a base URL missing its
  // /v1 suffix) to "set LLM_BASE_URL to <url>/v1." with the explanation of
  // what was actually wrong deleted.
  const dash = error.indexOf(' — ')
  if (dash !== -1) return error.slice(dash + 3)
  const prefix = `${url}/models `
  if (error.startsWith(prefix)) return error.slice(prefix.length)
  return error
}

/**
 * Database size in bytes, measured honestly for the ACTIVE provider — never a
 * literal, never a size read for one vendor and reported for another.
 *
 * TOD (pieces7/one-discord-sender-and-honest-db-usage): this used to run
 * `db().rpc('pg_database_size_bytes')` unconditionally and label whatever
 * came back "supabase", regardless of `lib/db.ts`'s actual `DB_PROVIDER`. On
 * this install (`TODERO_DB_PROVIDER=sqlite`, the default for a bare clone —
 * see `lib/db/adapters.ts`'s `detectProvider()`) that stored procedure does
 * not exist on the sqlite adapter's dialect, so the real behaviour was
 * "error, swallowed, return null" — the UI then rendered "0% used" against an
 * invented 500MB denominator with NOTHING measured at all. sqlite now reads
 * the actual file's size via `fs.statSync`; postgres/supabase keep the
 * stored-procedure path, which genuinely applies to them.
 */
async function dbSizeBytes(provider: string): Promise<number | null> {
  if (!isDbConfigured()) return null
  if (provider === 'sqlite') {
    try {
      return fs.statSync(sqlitePath()).size
    } catch {
      return null
    }
  }
  try {
    const { data, error } = await db().rpc('pg_database_size_bytes')
    if (error) return null
    return typeof data === 'number' ? data : null
  } catch {
    return null
  }
}

/**
 * All-time and today's Claude token/cost totals, summed from agent_runs.
 * TOD: kill-fake-infra-greens — this used to be a hardcoded `{ totalTokens: 0,
 * todayCost: 0 }` under a comment claiming it came "from agent_runs" when it
 * never queried the table at all. Returns null when the DB is unconfigured or
 * the query fails, so the caller can say "not tracked" instead of "$0.00".
 */
async function claudeTotals(): Promise<{ totalTokens: number; totalCost: number; todayTokens: number; todayCost: number } | null> {
  if (!isDbConfigured()) return null
  try {
    const { data, error } = await db().from('agent_runs').select('tokens_used, cost_usd, started_at')
    if (error || !Array.isArray(data)) return null
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    let totalTokens = 0, totalCost = 0, todayTokens = 0, todayCost = 0
    for (const r of data as Array<{ tokens_used?: number; cost_usd?: number; started_at?: string }>) {
      const tok = r.tokens_used ?? 0
      const cost = r.cost_usd ?? 0
      totalTokens += tok
      totalCost += cost
      if (r.started_at && new Date(r.started_at) >= todayStart) {
        todayTokens += tok
        todayCost += cost
      }
    }
    return { totalTokens, totalCost: +totalCost.toFixed(4), todayTokens, todayCost: +todayCost.toFixed(4) }
  } catch {
    return null
  }
}

export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data)
  }

  const dbProvider = db().provider

  // pieces7/one-discord-sender: Discord bot status resolves through the
  // shared sender (lib/discord-sender.ts) instead of reading
  // process.env.DISCORD_BOT_TOKEN directly, so this reflects a hub connection
  // when one exists rather than only the process-wide fallback.
  const [dbSize, localLlmProbe, cfKaos, discordBot, claudeUsage] = await Promise.allSettled([
    // 1. Database size, honest for whichever provider is actually active.
    // TOD-654: an upstream failure resolves to null rather than an error body,
    // which the readers below would otherwise treat as a real number.
    dbSizeBytes(dbProvider),

    // 2. Local LLM — a live GET against ${LLM_BASE_URL}/models, made fresh for
    // this request. No vendor key, no hardcoded roster: the model ids shown
    // are whatever the server actually reports right now.
    fetchLiveModels(),

    // 3. Cloudflare tunnel - kaos.nabit.work
    fetch('https://kaos.nabit.work', {
      signal: AbortSignal.timeout(3000),
      redirect: 'manual',
    }).then(r => ({ ok: r.status < 400 || r.status === 307, status: r.status }))
      .catch(() => ({ ok: false, status: 0 })),

    // 4. Discord bot status
    (async () => {
      const resolved = await resolveDiscordToken()
      if (!resolved) return { connected: false }
      const r = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${resolved.token}` },
        cache: 'no-store',
      })
      return { connected: r.ok }
    })().catch(() => ({ connected: false })),

    // 5. Claude token/cost totals, summed from agent_runs — real, not a literal.
    claudeTotals(),
  ])

  const now = new Date().toISOString()

  // --- Database ---
  // TOD (pieces7/one-discord-sender-and-honest-db-usage): this used to be
  // `let supabase = { dbBytes: null, dbLimitBytes: 500 * 1024 * 1024, plan:
  // 'Free Tier', lastChecked: now }` UNCONDITIONALLY — a Supabase plan number
  // applied to whatever provider this install actually runs, including the
  // sqlite default a bare clone gets. `dbLimitBytes`/`plan` are now null
  // unless something in this process genuinely knows a limit; this codebase
  // has no billing-API probe for Supabase either (same "kill-fake-infra-
  // greens" rule already applied to Vercel's plan and Claude's plan a few
  // lines below), so today that is every provider. `provider` is read live
  // from lib/db.ts's `DB_PROVIDER` — never a literal.
  const database: { provider: string; dbBytes: number | null; dbLimitBytes: number | null; plan: string | null; lastChecked: string } = {
    provider: dbProvider,
    dbBytes: null,
    dbLimitBytes: null,
    plan: null,
    lastChecked: now,
  }
  if (dbSize.status === 'fulfilled' && typeof dbSize.value === 'number') {
    database.dbBytes = dbSize.value
  }

  // --- Local LLM ---
  // Owner directive: no hosted LLM gateway, no cloud LLM. This is a live probe run for
  // this request — baseUrl and models come straight off the response, and a
  // failed probe names the URL and the exact reason rather than showing a
  // fabricated plan/balance for a vendor Todero doesn't use.
  let localLlmResult: { baseUrl: string; models: string[]; ok: boolean; error: string | null; kind?: LiveModelsFailureKind; lastChecked: string }
  if (localLlmProbe.status === 'fulfilled' && localLlmProbe.value.ok) {
    localLlmResult = { baseUrl: LLM_BASE_URL, models: localLlmProbe.value.models.map(m => m.id), ok: true, error: null, lastChecked: now }
  } else {
    let reason: string
    if (localLlmProbe.status === 'fulfilled' && !localLlmProbe.value.ok) {
      reason = reasonFrom(LLM_BASE_URL, localLlmProbe.value.error)
    } else if (localLlmProbe.status === 'rejected') {
      reason = localLlmProbe.reason instanceof Error ? localLlmProbe.reason.message : String(localLlmProbe.reason)
    } else {
      reason = 'unknown error'
    }
    // The lead word is the seam’s verdict, not an assumption. An endpoint
    // that answered 401, or answered 200 with HTML, is not unreachable.
    //
    // A REJECTED probe gets no kind at all: fetchLiveModels() catches every
    // network failure itself and returns `kind: 'unreachable'` for it, so a
    // rejection here is an internal fault of unknown shape. Calling that
    // "unreachable" would be the same invented diagnosis this whole change
    // exists to delete, one layer up.
    const kind: LiveModelsFailureKind | undefined =
      localLlmProbe.status === 'fulfilled' && !localLlmProbe.value.ok
        ? localLlmProbe.value.kind
        : undefined
    const lead =
      kind === 'unreachable' ? 'unreachable'
        : kind === 'error-status' ? 'error response'
          : kind === 'not-openai-compatible' ? 'not an OpenAI-compatible endpoint'
            : 'probe failed'
    localLlmResult = { baseUrl: LLM_BASE_URL, models: [], ok: false, error: `${lead} — ${LLM_BASE_URL} — ${reason}`, ...(kind ? { kind } : {}), lastChecked: now }
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
  // TOD: kill-fake-infra-greens — no `plan` field: this server has no way to
  // read the Claude CLI's local OAuth session, so asserting a paid tier here
  // was a guess wearing a measurement's clothes. totalTokens/todayCost are
  // real sums from agent_runs, or null when the query didn't run.
  const claudeResult = claudeUsage.status === 'fulfilled' ? claudeUsage.value : null
  const claude = claudeResult
    ? { totalTokens: claudeResult.totalTokens, totalCost: claudeResult.totalCost, todayCost: claudeResult.todayCost, lastChecked: now }
    : { totalTokens: null, totalCost: null, todayCost: null, lastChecked: now }

  // TOD: kill-fake-infra-greens — the old "Vercel (static)" block asserted a
  // `Pro $20/mo` plan, 1 seat, and a 2026-04-24 renewal date with no probe
  // behind any of the three. This server has no Vercel billing API access, so
  // there is nothing honest to report here; /api/status's `services.vercel`
  // (a real deployments-API probe) is the source of truth for Vercel status.
  const vercel = null

  const data = { database, localLlm: localLlmResult, cloudflare, discord, claude, vercel }
  cache = { data, ts: Date.now() }
  return NextResponse.json(data)
}
