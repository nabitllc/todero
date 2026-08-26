/**
 * connections-discord — "test it" for one connection.
 *
 *   POST /api/connections/hub/test  { id }
 *
 * Resolves the connection's credential server-side and asks the provider who
 * the credential belongs to. For Discord that is `GET /users/@me`, a read-only
 * identity call — it posts nothing and changes nothing.
 *
 * WHAT THIS ENDPOINT REFUSES TO DO
 *   It never reports success it did not observe. Three outcomes, and they are
 *   distinguishable in the response, because collapsing them is how a card ends
 *   up with a green tick over a dead integration:
 *     - `reachable: false` — the request never completed (offline, DNS, timeout).
 *       This says nothing about whether the credential is good.
 *     - `reachable: true, ok: false` — the provider answered and rejected it.
 *     - `reachable: true, ok: true` — the provider answered and named the bot.
 *   It also never echoes the credential, in any branch, including errors.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import { CONNECTIONS_TABLE, type ConnectionRow, resolveCredential } from '@/lib/connections'

const TIMEOUT_MS = 8000

export const POST = withPermission('settings:write', async (req: NextRequest): Promise<NextResponse> => {
  const gate = dbUnavailableResponse()
  if (gate) return gate

  let id = ''
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string') {
      id = (body as { id: string }).id
    }
  } catch {
    /* handled by the check below */
  }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data, error } = await db()
    .from(CONNECTIONS_TABLE)
    .select('id,business_id,provider,display_name,config,custody,credential_env_var,credential_hint,credential_set_at,updated_at')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: `no connection with id "${id}"` }, { status: 404 })

  const row = data as unknown as ConnectionRow

  if (row.provider !== 'discord') {
    return NextResponse.json({ error: `no test is implemented for provider "${row.provider}"` }, { status: 422 })
  }

  const token = await resolveCredential(row)
  if (!token) {
    // Not a failed test — an untestable connection. Said in those words so the
    // card cannot render it as "credential rejected".
    return NextResponse.json(
      {
        tested: false,
        reason:
          row.custody === 'env'
            ? `${row.credential_env_var ?? 'the named environment variable'} is not set in the server process, so there is nothing to test`
            : 'no readable credential is stored for this connection',
      },
      { status: 422 },
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'DiscordBot (https://kaos.nabit.work, 1.0)',
      },
      signal: controller.signal,
    })
    let username: string | null = null
    let botId: string | null = null
    if (res.ok) {
      const me = (await res.json()) as { username?: string; id?: string }
      username = me.username ?? null
      botId = me.id ?? null
    }
    return NextResponse.json({
      tested: true,
      reachable: true,
      ok: res.ok,
      status: res.status,
      bot: res.ok ? { username, id: botId } : null,
      checked_at: new Date().toISOString(),
      // The endpoint, so the card can print where the answer came from rather
      // than asserting one.
      source: 'GET https://discord.com/api/v10/users/@me',
    })
  } catch (e) {
    return NextResponse.json({
      tested: true,
      reachable: false,
      ok: false,
      // "Could not reach Discord" is not "the token is bad". Keep them apart.
      reason: e instanceof Error ? e.message : 'the request to Discord did not complete',
      checked_at: new Date().toISOString(),
      source: 'GET https://discord.com/api/v10/users/@me',
    })
  } finally {
    clearTimeout(timer)
  }
})
