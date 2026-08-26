// lib/discord-sender.ts — ONE Discord send/probe path for every route.
//
// pieces7/one-discord-sender. Before this file existed, `resolveHubDiscord()`
// (lib/connections.ts) had exactly ONE caller — app/api/notify/route.ts — so a
// per-hub Discord credential added through Settings -> Connections governed
// exactly one of the app's send paths. Every other route that posts to
// Discord, or probes it, read `process.env.DISCORD_BOT_TOKEN` directly:
//
//   app/api/issues/route.ts        (two sites — postDiscord, notifyWatchers)
//   app/api/releases/route.ts
//   app/api/sprint-close/route.ts
//   app/api/sprint-start/route.ts
//   app/api/status/route.ts        (a health probe, not a send)
//   app/api/settings/usage/route.ts (a health probe, not a send)
//   lib/loop-breaker.ts
//
// so a hub credential the operator adds through the UI was decorative for all
// seven. This module is the one place any of them go through now.
//
// RESOLUTION ORDER (identical to app/api/notify/route.ts's sendDiscord(),
// which this wraps rather than reimplements): a hub's own connection first
// (`resolveHubDiscord(businessId)`), the process-wide `DISCORD_BOT_TOKEN` only
// as the documented fallback for a hub with no connection row, and — when
// NEITHER exists — a refusal that NAMES the reason. Never a silent drop:
// every refusal here is also logged via `console.error`, so an operator
// watching server logs learns a message did not go out even when the caller
// does not itself check the return value (several call sites are
// fire-and-forget, `void sendDiscordMessage(...)`, by design — see each call
// site for why).
//
// `businessId` is optional everywhere in this module. A caller with no hub
// context (loop-breaker, releases, and — today — issues/route.ts's two sites,
// which are the highest-risk file in the repo and are scoped to a *token
// resolution* swap only, not a hub-threading refactor) passes none, and
// resolution falls straight to the env fallback — the exact behaviour every
// one of these files had before this module existed. sprint-close/-start DO
// have `business_id` in scope and pass it through, so THEIR sends resolve a
// hub's own credential first.

import { resolveHubDiscord } from '@/lib/connections'

export interface DiscordSendResult {
  ok: boolean
  status?: number
  error?: string
  source?: string
}

/**
 * POST a text message to a Discord channel.
 *
 * Never throws. A resolution failure or a network failure both come back as
 * `{ ok: false, error }` — logged here via `console.error` in addition to
 * being returned, so a fire-and-forget caller (`void sendDiscordMessage(...)`)
 * still leaves a trace of the drop.
 */
export async function sendDiscordMessage(
  channelId: string,
  content: string,
  businessId?: string | null,
): Promise<DiscordSendResult> {
  const resolved = await resolveHubDiscord(businessId ?? null)
  if (!resolved) {
    const error = businessId
      ? `no Discord connection is configured for hub "${businessId}", and DISCORD_BOT_TOKEN is not set as a process-wide fallback`
      : 'DISCORD_BOT_TOKEN is not set, and no business_id was given to resolve a per-hub connection'
    console.error(`[discord] message NOT sent to channel ${channelId} — ${error}`)
    return { ok: false, error }
  }
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${resolved.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }), // Discord limit
    })
    if (res.ok) return { ok: true, status: res.status, source: resolved.source }
    const err = await res.text().catch(() => '')
    console.error(`[discord] channel ${channelId} responded ${res.status}: ${err.slice(0, 200)}`)
    return { ok: false, status: res.status, error: err.slice(0, 200), source: resolved.source }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[discord] send to channel ${channelId} failed: ${error}`)
    return { ok: false, error }
  }
}

/**
 * Resolve just the bot token, for a caller that needs to make a Discord API
 * call that is not "post a message" (opening a DM channel, a `users/@me`
 * identity probe). Same resolution order as `sendDiscordMessage`. Returns
 * `null` — never a placeholder — when nothing is configured for this
 * business/host, so the caller can say so rather than sending an empty
 * Authorization header and letting Discord's 401 be the only record.
 */
export async function resolveDiscordToken(
  businessId?: string | null,
): Promise<{ token: string; source: string } | null> {
  const resolved = await resolveHubDiscord(businessId ?? null)
  return resolved ? { token: resolved.token, source: resolved.source } : null
}
