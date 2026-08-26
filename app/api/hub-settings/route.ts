/**
 * TOD-2415 — per-hub settings, key/value.
 *
 * GET  /api/hub-settings?business_id=<id>   -> { settings: { key: value } }
 * PATCH /api/hub-settings                   -> { business_id, key, value }
 *
 * First consumer is `bolt_start_hour`. The table (migration 058) stores TEXT,
 * so validation lives here rather than at the read site: a settings row saying
 * "25" must be refused when it is written, not rendered as a bolt opening at
 * 25:00 and then defended against by every reader.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import { parseStartHour } from '@/lib/bolt-time'

interface HubSettingRow {
  key: string
  value: string
}

/**
 * Validators per key. A key with no validator is REFUSED rather than stored —
 * an open key/value endpoint is an open write to a table the app reads back
 * and trusts. Adding a setting is deliberately a code change.
 */
const VALIDATORS: Record<string, (raw: string) => { ok: true; value: string } | { ok: false; why: string }> = {
  bolt_start_hour: (raw) => {
    const hour = parseStartHour(raw)
    if (hour === null) {
      return { ok: false, why: 'bolt_start_hour must be a whole hour from 0 to 23' }
    }
    return { ok: true, value: String(hour) }
  },
}

export const GET = withPermission(
  'settings:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const businessId = req.nextUrl.searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 })
    }

    const { data, error } = await db()
      .from('hub_settings')
      .select('key,value')
      .eq('business_id', businessId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const settings: Record<string, string> = {}
    for (const row of (data ?? []) as HubSettingRow[]) settings[row.key] = row.value

    return NextResponse.json({ settings })
  },
)

export const PATCH = withPermission(
  'settings:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    let body: { business_id?: string; key?: string; value?: string | number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'body must be JSON' }, { status: 400 })
    }

    const { business_id: businessId, key } = body
    if (!businessId || !key) {
      return NextResponse.json({ error: 'business_id and key are required' }, { status: 400 })
    }

    const validate = VALIDATORS[key]
    if (!validate) {
      // Fail closed. An unknown key is a typo or an injection, never a feature.
      return NextResponse.json(
        { error: `unknown setting "${key}"`, known: Object.keys(VALIDATORS) },
        { status: 400 },
      )
    }

    const verdict = validate(String(body.value ?? ''))
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.why }, { status: 422 })
    }

    // upsert — one row per (business_id, key), per the composite primary key.
    const { error } = await db()
      .from('hub_settings')
      .upsert(
        { business_id: businessId, key, value: verdict.value, updated_at: new Date().toISOString() },
        { onConflict: 'business_id,key' },
      )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ key, value: verdict.value })
  },
)
