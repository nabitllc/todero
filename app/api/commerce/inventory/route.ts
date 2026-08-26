/**
 * Inventory — commerce-operations piece (Wave 7).
 *
 *   GET   /api/commerce/inventory                  -> { project, total, levels }
 *   GET   /api/commerce/inventory?below_reorder=1  -> only levels at/under their reorder point
 *   GET   /api/commerce/inventory?history=<sku>    -> the audit trail for one SKU
 *                                                    (stock adjustments AND
 *                                                     catalogue changes — see
 *                                                     the handler for why both)
 *   PATCH /api/commerce/inventory                  -> ADJUST a level (the action)
 *
 * THE ACTION THIS ROUTE EXISTS FOR
 *   `PATCH` with `{ sku, location?, delta, reason }` changes stock by exactly
 *   `delta` and appends one `commerce_actions` row recording who, what, from,
 *   to and why. This is the difference the channel goal names: a dashboard
 *   reports that stock is 12; a console lets an operator make it 8 and says
 *   who did it.
 *
 *   Four things it refuses, each of which is a real defect:
 *     * no `reason`             — stock that changed for no recorded reason
 *     * a result below zero     — negative physical inventory
 *     * `delta` 0 or fractional — an adjustment that says nothing
 *     * an unknown sku          — an adjustment cannot conjure a product
 *   A refused adjustment writes NOTHING: not the level, not the audit row.
 *
 * ATOMIC UNDER CONCURRENCY (TOD-2449)
 *   This used to read the current level and write `on_hand + delta` as two
 *   separate statements — correct for one operator, and PROVEN wrong under
 *   real concurrency: 20 concurrent `delta: -1` requests against a SKU seeded
 *   to 999 all answered 200, and the SKU read back 980, not 979. One decrement
 *   was lost with no error anywhere in the 20 responses.
 *
 *   The handler below is compare-and-swap: the write's WHERE clause pins
 *   `on_hand` to the exact value just read, in the same statement as the
 *   write, so a write only lands if nothing else changed the row first. A
 *   lost race is detected (the WHERE matches zero rows) and retried against a
 *   fresh read, bounded at 8 attempts, rather than silently overwritten. See
 *   docs/rebuild/pieces/pieces7/commerce-hardening.md for the concurrency
 *   test and the before/after numbers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  INVENTORY_ADJUST_FIELDS,
  applyAdjustment,
  rejectUnknownFields,
  validateAdjustment,
  validateSku,
} from '@/lib/commerce'
import { commerceActor, commerceScope } from '../scope'

interface LevelRow {
  id: string
  project: string
  sku: string
  location: string
  on_hand: number
  reorder_point: number
  updated_at?: string
}

interface ActionRow {
  id: string
  action: string
  /** 'inventory' (a stock adjustment) or 'product' (a catalogue change).
   *  Both are keyed by SKU, so both belong in one SKU's history — see the
   *  `?history=` block for why this field has to be in the response. */
  object_type: string
  object_ref: string
  from_value: string | null
  to_value: string
  reason: string | null
  actor: string
  created_at: string
}

/**
 * "About to run out" = a level at or under a reorder point that was actually
 * SET. `reorder_point` defaults to 0, which means "never warn" — without that
 * clause a freshly created catalogue, every SKU at 0 stock and 0 reorder
 * point, would report every product as critically low. That number would be
 * technically derived from a query and still be a lie.
 */
function isBelowReorder(row: LevelRow): boolean {
  return row.reorder_point > 0 && row.on_hand <= row.reorder_point
}

export const GET = withPermission(
  'commerce:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const scoped = commerceScope(req, 'read')
    if ('refusal' in scoped) return scoped.refusal
    const { project } = scoped.scope

    const history = req.nextUrl.searchParams.get('history')
    if (history !== null) {
      const sku = validateSku(history)
      if (!sku.ok) {
        return NextResponse.json({ error: 'invalid_sku', message: sku.why }, { status: 422 })
      }
      // WHY `.in([inventory, product])` AND NOT `.eq('inventory')`
      //   `commerce_actions` is written from five sites. Three of them key the
      //   row by SKU: inventory.adjust here (:~245), inventory.adjust again in
      //   orders/route.ts when a fulfilment moves stock, and product.create /
      //   product.update in products/route.ts — those last two write
      //   `object_type: 'product'` with `object_ref` set to the SAME sku.
      //
      //   This read used to filter `object_type = 'inventory'`, so "what
      //   happened to this SKU" answered with only half its own trail: every
      //   price change, status change and the row's own creation were written
      //   and then hidden from the only endpoint that reads the table. The
      //   product rows were unreadable by ANY code path — not archived, not
      //   filtered by choice, just unreachable.
      //
      //   Both kinds are keyed by SKU and both are things that happened to this
      //   SKU, so both belong here; `object_type` is returned so a caller can
      //   still tell a stock movement from a catalogue edit.
      //
      // STILL WRITE-ONLY, SAID PLAINLY
      //   `order.fulfilment` rows (orders/route.ts) are keyed by ORDER NUMBER,
      //   not by SKU, so they cannot surface through a SKU-keyed read and no
      //   endpoint reads them today. They are written correctly and kept
      //   deliberately — an audit trail nothing reads YET is a different thing
      //   from one that is wrong — but nothing can currently show them. That
      //   needs a read on the orders route, which this piece does not own.
      const { data, error, count } = await db()
        .from('commerce_actions')
        .select('*', { count: 'exact' })
        .eq('project', project)
        .in('object_type', ['inventory', 'product'])
        .eq('object_ref', sku.value)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) return dbQueryErrorResponse(error, 'commerce_actions')
      const rows = (data ?? []) as unknown as ActionRow[]
      return NextResponse.json({ project, sku: sku.value, total: count ?? rows.length, history: rows })
    }

    const belowReorder = ['1', 'true', 'yes'].includes(
      (req.nextUrl.searchParams.get('below_reorder') ?? '').toLowerCase(),
    )
    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw === null ? 100 : Number(limitRaw)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { error: 'bad_limit', message: 'limit must be a whole number from 1 to 500' },
        { status: 400 },
      )
    }

    // `on_hand <= reorder_point` compares two COLUMNS, which the database seam
    // (lib/db.ts) has no vocabulary for — every filter there is column-to-VALUE.
    // So the below-reorder set is computed here, over EVERY level in the
    // project rather than over a page of them, and `total` is the size of that
    // full filtered set. `limit` then bounds only the rows returned. The number
    // the card renders is therefore a true total, never a page length.
    const { data, error, count } = await db()
      .from('inventory_levels')
      .select('*', { count: 'exact' })
      .eq('project', project)
      .order('sku', { ascending: true })
    if (error) return dbQueryErrorResponse(error, 'inventory_levels')

    const all = (data ?? []) as unknown as LevelRow[]
    const matching = belowReorder ? all.filter(isBelowReorder) : all
    const total = belowReorder ? matching.length : count ?? all.length

    return NextResponse.json({
      project,
      total,
      below_reorder: belowReorder,
      levels: matching.slice(0, limit).map(row => ({
        sku: row.sku,
        location: row.location,
        on_hand: row.on_hand,
        reorder_point: row.reorder_point,
        below_reorder: isBelowReorder(row),
        updated_at: row.updated_at ?? null,
      })),
    })
  },
)

export const PATCH = withPermission(
  'commerce:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'bad_json', message: 'body must be JSON' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'bad_json', message: 'body must be a JSON object' }, { status: 400 })
    }

    const scoped = commerceScope(req, 'write', typeof body.project === 'string' ? body.project : null)
    if ('refusal' in scoped) return scoped.refusal
    const { project } = scoped.scope

    // 400 for a field this endpoint does not implement (the hub-settings
    // stance), separately from the 422 a well-formed body with a bad value
    // gets. `validateAdjustment` checks it again, so the contract holds for
    // any caller of the validator, not only for this route.
    const known = rejectUnknownFields(body, INVENTORY_ADJUST_FIELDS)
    if (!known.ok) {
      return NextResponse.json({ error: 'unknown_field', message: known.why }, { status: 400 })
    }

    const adjustment = validateAdjustment(body)
    if (!adjustment.ok) {
      return NextResponse.json({ error: 'invalid_adjustment', message: adjustment.why }, { status: 422 })
    }
    const { sku, location, delta, reason } = adjustment.value

    // ATOMIC ADJUST, PROVEN UNDER CONCURRENCY (TOD-2449).
    //
    // The comment this replaced said "read-modify-write, honestly" and pointed
    // at the CHECK (on_hand >= 0) as the floor under a lost update. Measured
    // against the running server: seed one SKU to 999, fire 20 concurrent
    // `delta: -1` PATCHes at it. All 20 answered 200. Final on_hand read back
    // 980, not 979 — one decrement vanished, silently, with no error anywhere
    // in the 20 responses. That is the defect this replaces, not a theoretical
    // one.
    //
    // THE FIX is compare-and-swap, not a bigger lock: the UPDATE's WHERE clause
    // pins `on_hand` to the exact value just read, in the SAME statement as the
    // write (`UPDATE ... WHERE on_hand = <value just read> RETURNING *`). If
    // another writer changed the row first, this WHERE matches zero rows and
    // `RETURNING *` comes back empty — that is the signal, not an error — so
    // the loop re-reads the now-current value and tries again. Two writers can
    // race the read, but only one can ever win a given write, because the
    // write and the check-that-nothing-moved are one statement, not two.
    //
    // No new adapter method, no raw SQL, no transaction isolation level to get
    // wrong: this is the same `.update().eq()` chain every other route in this
    // file already uses, with one more `.eq('on_hand', …)` added to it.
    const MAX_ATTEMPTS = 8
    let level: LevelRow | null = null
    let nextOnHand: number | null = null
    const now = new Date().toISOString()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data: current, error: readError } = await db()
        .from('inventory_levels')
        .select('*')
        .eq('project', project)
        .eq('sku', sku)
        .eq('location', location)
        .maybeSingle<LevelRow>()
      if (readError) return dbQueryErrorResponse(readError, 'inventory_levels')

      if (!current) {
        // An adjustment cannot conjure a product. 404 rather than creating the
        // row, and 404 rather than 403 so a scoped caller cannot use this
        // endpoint to discover which SKUs exist in another storefront.
        return NextResponse.json(
          {
            error: 'not_found',
            message:
              `${project} has no stock record for sku "${sku}" at location "${location}". ` +
              `Create the product first — an adjustment records a change to something that exists.`,
          },
          { status: 404 },
        )
      }

      const attemptNext = applyAdjustment(current.on_hand, delta)
      if (!attemptNext.ok) {
        return NextResponse.json({ error: 'below_zero', message: attemptNext.why }, { status: 422 })
      }

      const { data: written, error: writeError } = await db()
        .from('inventory_levels')
        .update({ on_hand: attemptNext.value, updated_at: now })
        .eq('project', project)
        .eq('sku', sku)
        .eq('location', location)
        .eq('on_hand', current.on_hand)
        .select('*')
      if (writeError) return dbQueryErrorResponse(writeError, 'inventory_levels')

      if (((written ?? []) as unknown[]).length > 0) {
        level = current
        nextOnHand = attemptNext.value
        break
      }
      // The WHERE matched nothing: another write landed between our read and
      // our write. Loop and re-read the now-current value — never apply this
      // attempt's delta on top of a value we know is stale.
    }

    if (level === null || nextOnHand === null) {
      return NextResponse.json(
        {
          error: 'conflict',
          message:
            `too many concurrent writers to "${sku}" at "${location}" — the adjustment did not land ` +
            `after ${MAX_ATTEMPTS} attempts. Nothing was changed; retry the adjustment.`,
        },
        { status: 409 },
      )
    }
    const next = { ok: true as const, value: nextOnHand }

    // The audit row is written only AFTER the level actually changed. An audit
    // trail that records intentions rather than effects is worse than none.
    await db().from('commerce_actions').insert({
      project,
      action: 'inventory.adjust',
      object_type: 'inventory',
      object_ref: sku,
      from_value: String(level.on_hand),
      to_value: String(next.value),
      reason,
      actor: commerceActor(req),
      created_at: now,
    })

    return NextResponse.json({
      project,
      sku,
      location,
      previous_on_hand: level.on_hand,
      delta,
      on_hand: next.value,
      reason,
    })
  },
)
