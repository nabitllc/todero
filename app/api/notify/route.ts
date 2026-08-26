// TOD-801: Single notification endpoint for all Todero-pipeline scripts.
// One endpoint. One place to rotate tokens. One place to fan out to channels.
//
// POST body shape:
//   {
//     "text": "required — the message body",
//     "channels": ["discord-alerts", "telegram-dm", "telegram-group"],
//     "discordChannelId": "optional — override channel",
//     "level": "info" | "warn" | "error",
//     "business_id": "optional — resolve Discord credential per-hub"
//   }
//
// Channel registry is below. Adding a new named channel: one line in CHANNELS.
//
// connections-discord / FEEDBACK.md item 9, wave 7. This endpoint used to be
// "the one place to rotate tokens" in name only: it read
// process.env.DISCORD_BOT_TOKEN directly, so a per-hub credential added
// through Settings -> Connections (lib/connections.ts, migration 059) was
// never consulted by anything that actually sends a message.
// `resolveHubDiscord()` had zero callers anywhere in the tree — grep it.
//
// When a caller names `business_id`, the Discord send now resolves through
// `resolveHubDiscord()`: a hub's own stored/env connection first, and the
// process-wide `DISCORD_BOT_TOKEN` only as the documented fallback for a hub
// with no connection row. When no connection AND no env fallback exist, the
// send is REFUSED with a message naming the hub — never a silent post as
// somebody else's bot, and never a silent no-op either.
import { NextRequest, NextResponse } from 'next/server'
import { resolveCallerRole, checkRoutePermission } from '@/lib/permission-check'
import { resolveHubDiscord } from '@/lib/connections'

// ── Token config (lazy getters — fail at request time, not module load) ─────
// Module-load reads break `next build` on CI, which doesn't have .env.local
// or GitHub Secrets for bot tokens. Lazy access still fails loud when an
// actual send is attempted, preventing silent empty-token prod deploys.
function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

// ── Channel registry — single source of truth ──────────────────────────────
// `target` is a thunk so env-var-backed targets (Telegram chat IDs) resolve
// at request time, not at module load.
interface ChannelConfig {
  transport: 'discord' | 'telegram'
  target: () => string
  label: string
}

const CHANNELS: Record<string, ChannelConfig> = {
  // Discord channels
  'discord-alerts':        { transport: 'discord', target: () => '1485333335868834063', label: '#alerts' },
  'discord-deploy':        { transport: 'discord', target: () => '1487826368170299592', label: '#3-ready-for-deploy' },
  'discord-completed':     { transport: 'discord', target: () => '1487584901678104698', label: '#4-done' },
  'discord-daily-standup': { transport: 'discord', target: () => '1489262030115012648', label: '#daily-standup' },
  'discord-sprint-close':  { transport: 'discord', target: () => '1489262074687983656', label: '#sprint-close' },
  'discord-retro':         { transport: 'discord', target: () => '1489262104677568542', label: '#retro' },
  'discord-sprint-start':  { transport: 'discord', target: () => '1489262137221976115', label: '#sprint-start' },
  'discord-signoff':       { transport: 'discord', target: () => '1489262196969263165', label: '#3-signoff' },
  'discord-rejected':      { transport: 'discord', target: () => '1489262259762667580', label: '#2-rejected' },

  // Telegram
  'telegram-dm':    { transport: 'telegram', target: () => requireEnv('TELEGRAM_DM_CHAT'),    label: 'Michael DM' },
  'telegram-group': { transport: 'telegram', target: () => requireEnv('TELEGRAM_GROUP_CHAT'), label: 'KAOS group' },
}

// ── Transport implementations ───────────────────────────────────────────────
/**
 * `businessId` is optional because most existing callers (circuit-breaker,
 * cron/queue-refill, cron/watchdog, run-sprint) send system-wide alerts with
 * no hub context — for those, `resolveHubDiscord(undefined)` falls straight
 * through to its own env-var fallback, which is the same behaviour this
 * function had before. A caller that DOES name a hub gets that hub's own
 * connection, and an honest refusal (never a silent post, never a silent
 * env-var fallback) when the hub has neither a connection nor the env var.
 */
async function sendDiscord(
  channelId: string,
  text: string,
  businessId?: string,
): Promise<{ ok: boolean; status?: number; error?: string; source?: string }> {
  try {
    const resolved = await resolveHubDiscord(businessId ?? null)
    if (!resolved) {
      return {
        ok: false,
        error: businessId
          ? `no Discord connection is configured for hub "${businessId}", and DISCORD_BOT_TOKEN is not set as a process-wide fallback`
          : 'DISCORD_BOT_TOKEN is not set, and no business_id was given to resolve a per-hub connection',
      }
    }
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${resolved.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
      },
      body: JSON.stringify({ content: text.slice(0, 2000) }),  // Discord limit
    })
    if (res.ok) return { ok: true, status: res.status, source: resolved.source }
    const err = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: err.slice(0, 200), source: resolved.source }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function sendTelegram(chatId: string, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const token = requireEnv('TELEGRAM_BOT_TOKEN')
    // Split oversized messages — Telegram's limit is 4096 chars
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += 4000) {
      chunks.push(text.slice(i, i + 4000))
    }
    for (const chunk of chunks) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      })
      if (!res.ok) {
        const err = await res.text().catch(() => '')
        return { ok: false, status: res.status, error: err.slice(0, 200) }
      }
    }
    return { ok: true, status: 200 }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Rate limit (Gap 5) ──────────────────────────────────────────────────────
// Simple in-memory token bucket per channel. Prevents burst floods from crashing
// Discord/Telegram or hitting provider-side 429s. Buckets reset on process restart
// (acceptable — server runs for days, bursts don't).
const RATE_LIMIT_WINDOW_MS = 60_000      // 60 seconds
const RATE_LIMIT_MAX_PER_CHANNEL = 20    // 20 messages per channel per minute
interface BucketState { count: number; resetAt: number }
const rateLimitBuckets: Record<string, BucketState> = {}

function isRateLimited(channel: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets[channel]
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets[channel] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
    return false
  }
  bucket.count++
  return bucket.count > RATE_LIMIT_MAX_PER_CHANNEL
}

// ── POST /api/notify ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const REQUIRED_PERMISSION = 'agents:write' as const
  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'POST', '/api/notify')
    if (!perm.allowed) return NextResponse.json(perm.body, { status: perm.status })
  }

  let body: {
    text?: string
    channels?: string[]
    discordChannelId?: string
    level?: 'info' | 'warn' | 'error'
    business_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const text = body.text?.trim()
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  // Optional — see sendDiscord() for what this changes and what it does not.
  const businessId = typeof body.business_id === 'string' && body.business_id.trim() !== ''
    ? body.business_id.trim()
    : undefined

  // If no channels specified, default based on level
  let channels = body.channels ?? []
  if (channels.length === 0) {
    channels = body.level === 'error'
      ? ['discord-alerts', 'telegram-dm']
      : ['discord-completed']
  }

  // Allow ad-hoc Discord channel override
  if (body.discordChannelId) {
    channels.push(`adhoc:discord:${body.discordChannelId}`)
  }

  const results: Array<{ channel: string; ok: boolean; status?: number; error?: string; source?: string }> = []

  for (const channelName of channels) {
    // Rate limit check
    if (isRateLimited(channelName)) {
      results.push({ channel: channelName, ok: false, error: `rate limited (${RATE_LIMIT_MAX_PER_CHANNEL}/min exceeded)` })
      continue
    }

    // Ad-hoc override handling
    if (channelName.startsWith('adhoc:discord:')) {
      const id = channelName.slice('adhoc:discord:'.length)
      const r = await sendDiscord(id, text, businessId)
      results.push({ channel: channelName, ...r })
      continue
    }

    const cfg = CHANNELS[channelName]
    if (!cfg) {
      results.push({ channel: channelName, ok: false, error: 'unknown channel' })
      continue
    }

    let target: string
    try {
      target = cfg.target()
    } catch (e) {
      results.push({ channel: channelName, ok: false, error: e instanceof Error ? e.message : String(e) })
      continue
    }

    const r = cfg.transport === 'discord'
      ? await sendDiscord(target, text, businessId)
      : await sendTelegram(target, text)
    results.push({ channel: channelName, ...r })
  }

  const anyOk = results.some(r => r.ok)
  return NextResponse.json(
    { ok: anyOk, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results },
    { status: anyOk ? 200 : 500 }
  )
}

// ── GET /api/notify — list known channels ──────────────────────────────────
export async function GET() {
  return NextResponse.json({
    channels: Object.entries(CHANNELS).map(([name, cfg]) => ({
      name,
      transport: cfg.transport,
      label: cfg.label,
    })),
    count: Object.keys(CHANNELS).length,
  })
}
