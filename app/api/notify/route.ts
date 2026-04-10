// TOD-801: Single notification endpoint for all Todero-pipeline scripts.
// Replaces direct Discord webhook POSTs, openclaw message send calls, and
// direct Telegram API calls scattered across ~6 scripts + 3 routes.
//
// One endpoint. One place to rotate tokens. One place to fan out to channels.
//
// POST body shape:
//   {
//     "text": "required — the message body",
//     "channels": ["discord-alerts", "telegram-dm", "telegram-group"],
//     "discordChannelId": "optional — override channel",
//     "level": "info" | "warn" | "error"
//   }
//
// Channel registry is below. Adding a new named channel: one line in CHANNELS.
import { NextRequest, NextResponse } from 'next/server'

// ── Token config (prefers env, falls back to hardcoded for dev) ─────────────
const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN ??
  'MTQ4NjA0MTQ3MTUwNDM1MTMxMw.GoiBGW.VS2nGK2X1LMjMjkOBL9NqrOVeUdZfbGo9HdAyo'

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ??
  '8792497927:AAEcRevJI2KnxlKpHochhSJj4-SviK281is'

const TELEGRAM_GROUP_CHAT = process.env.TELEGRAM_GROUP_CHAT ?? '-1003598670302'
const TELEGRAM_DM_CHAT    = process.env.TELEGRAM_DM_CHAT    ?? '5084875115'

// ── Channel registry — single source of truth ──────────────────────────────
interface ChannelConfig {
  transport: 'discord' | 'telegram'
  target: string  // channel ID or chat ID
  label: string
}

const CHANNELS: Record<string, ChannelConfig> = {
  // Discord channels
  'discord-alerts':        { transport: 'discord', target: '1485333335868834063', label: '#alerts' },
  'discord-deploy':        { transport: 'discord', target: '1487826368170299592', label: '#3-ready-for-deploy' },
  'discord-completed':     { transport: 'discord', target: '1487584901678104698', label: '#4-done' },
  'discord-daily-standup': { transport: 'discord', target: '1489262030115012648', label: '#daily-standup' },
  'discord-sprint-close':  { transport: 'discord', target: '1489262074687983656', label: '#sprint-close' },
  'discord-retro':         { transport: 'discord', target: '1489262104677568542', label: '#retro' },
  'discord-sprint-start':  { transport: 'discord', target: '1489262137221976115', label: '#sprint-start' },
  'discord-signoff':       { transport: 'discord', target: '1489262196969263165', label: '#3-signoff' },
  'discord-rejected':      { transport: 'discord', target: '1489262259762667580', label: '#2-rejected' },

  // Telegram
  'telegram-dm':    { transport: 'telegram', target: TELEGRAM_DM_CHAT,    label: 'Michael DM' },
  'telegram-group': { transport: 'telegram', target: TELEGRAM_GROUP_CHAT, label: 'KAOS group' },
}

// ── Transport implementations ───────────────────────────────────────────────
async function sendDiscord(channelId: string, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
      },
      body: JSON.stringify({ content: text.slice(0, 2000) }),  // Discord limit
    })
    if (res.ok) return { ok: true, status: res.status }
    const err = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: err.slice(0, 200) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function sendTelegram(chatId: string, text: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    // Split oversized messages — Telegram's limit is 4096 chars
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += 4000) {
      chunks.push(text.slice(i, i + 4000))
    }
    for (const chunk of chunks) {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
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

// ── POST /api/notify ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: {
    text?: string
    channels?: string[]
    discordChannelId?: string
    level?: 'info' | 'warn' | 'error'
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

  const results: Array<{ channel: string; ok: boolean; status?: number; error?: string }> = []

  for (const channelName of channels) {
    // Ad-hoc override handling
    if (channelName.startsWith('adhoc:discord:')) {
      const id = channelName.slice('adhoc:discord:'.length)
      const r = await sendDiscord(id, text)
      results.push({ channel: channelName, ...r })
      continue
    }

    const cfg = CHANNELS[channelName]
    if (!cfg) {
      results.push({ channel: channelName, ok: false, error: 'unknown channel' })
      continue
    }

    const r = cfg.transport === 'discord'
      ? await sendDiscord(cfg.target, text)
      : await sendTelegram(cfg.target, text)
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
