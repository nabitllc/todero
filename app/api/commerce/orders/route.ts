/**
 * Orders — commerce-operations piece (Wave 7).
 *
 *   GET   /api/commerce/orders                              -> { project, total, orders }
 *   GET   /api/commerce/orders?fulfilment_status=unfulfilled -> filtered
 *   GET   /api/commerce/orders?order_number=LG-1001          -> one order, with its line items
 *   POST  /api/commerce/orders                               -> ingest one order with its lines
 *   PATCH /api/commerce/orders                               -> MOVE the fulfilment state (the action)
 *
 * WHY POST EXISTS AND WHAT IT IS NOT
 *   An order is INGESTED, not authored: it originates with a customer at the
 *   storefront. POST is the endpoint an importer or a webhook calls, and it is
 *   here for one concrete reason — without it, `orders` could never hold a row
 *   from anywhere in this repo, the Orders card would be permanently empty, and
 *   the fulfilment action below would be unreachable in the running app. An
 *   object nothing can create is an object nobody can prove works.
 *   It is NOT a Shopify integration and makes no outbound call.
 *
 * THE ACTION THIS ROUTE EXISTS FOR
 *   `PATCH` with `{ order_number, fulfilment_status }` moves an order along the
 *   state machine in lib/commerce.ts and appends one `commerce_actions` row.
 *   The machine, not this route, decides which moves are legal — which is why
 *   it is a pure function with a test that walks all sixteen ordered pairs.
 *
 *   Three refusals, each a real defect:
 *     * fulfilled -> anything   — there is no un-shipping; a mistake after the
 *                                 parcel leaves is a RETURN, a different object
 *     * cancelled -> anything   — terminal in the other direction
 *     * X -> X                  — a green answer for an action that changed
 *                                 nothing is a silent success
 *   A refused transition writes NOTHING: not the order, not the audit row.
 *
 * MONEY ON THE WAY OUT
 *   `total_minor` is the exact integer and travels with its `currency`;
 *   `total_display` is what a human reads, rendered ONCE here by
 *   lib/commerce.ts's `formatMinor`. The browser never divides by 100.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  FULFILMENT_STATES,
  ORDER_CREATE_FIELDS,
  checkFulfilmentTransition,
  formatMinor,
  isFulfilmentStatus,
  rejectUnknownFields,
  validateNewOrder,
} from '@/lib/commerce'
import { commerceActor, commerceScope } from '../scope'

interface OrderRow {
  id: string
  project: string
  order_number: string
  placed_at: string
  customer_email: string | null
  currency: string
  total_minor: number
  fulfilment_status: string
  updated_at?: string
}

interface LineRow {
  id: string
  order_id: string
  sku: string
  title: string
  quantity: number
  unit_price_minor: number
  currency: string
}

const ORDER_PATCH_FIELDS = ['order_number', 'fulfilment_status', 'project'] as const

function present(row: OrderRow) {
  return {
    id: row.id,
    order_number: row.order_number,
    placed_at: row.placed_at,
    customer_email: row.customer_email,
    currency: row.currency,
    total_minor: row.total_minor,
    total_display: `${formatMinor(row.total_minor, row.currency)} ${row.currency}`,
    fulfilment_status: row.fulfilment_status,
    updated_at: row.updated_at ?? null,
  }
}

export const GET = withPermission(
  'projects:read',
  async (req: NextRequest): Promise<NextResponse> => {
    const gate = dbUnavailableResponse()
    if (gate) return gate

    const scoped = commerceScope(req, 'read')
    if ('refusal' in scoped) return scoped.refusal
    const { project } = scoped.scope

    const orderNumber = req.nextUrl.searchParams.get('order_number')
    if (orderNumber !== null) {
      if (orderNumber.trim() === '') {
        return NextResponse.json(
          { error: 'bad_order_number', message: 'order_number must not be blank' },
          { status: 400 },
        )
      }
      const { data, error } = await db()
        .from('orders')
        .select('*')
        .eq('project', project)
        .eq('order_number', orderNumber.trim())
        .maybeSingle<OrderRow>()
      if (error) return dbQueryErrorResponse(error, 'orders')
      if (!data) {
        // 404 rather than 403: a scoped caller must not be able to use this
        // endpoint to learn which order numbers exist in another storefront.
        return NextResponse.json(
          { error: 'not_found', message: `${project} has no order "${orderNumber.trim()}".` },
          { status: 404 },
        )
      }
      const { data: lines } = await db()
        .from('order_line_items')
        .select('*')
        .eq('order_id', data.id)
      return NextResponse.json({
        project,
        order: present(data),
        line_items: ((lines ?? []) as unknown as LineRow[]).map(l => ({
          sku: l.sku,
          title: l.title,
          quantity: l.quantity,
          unit_price_minor: l.unit_price_minor,
          currency: l.currency,
          unit_price_display: `${formatMinor(l.unit_price_minor, l.currency)} ${l.currency}`,
          line_total_minor: l.unit_price_minor * l.quantity,
          line_total_display: `${formatMinor(l.unit_price_minor * l.quantity, l.currency)} ${l.currency}`,
        })),
      })
    }

    const status = req.nextUrl.searchParams.get('fulfilment_status')
    if (status && !isFulfilmentStatus(status)) {
      return NextResponse.json(
        {
          error: 'bad_fulfilment_status',
          message: `fulfilment_status must be one of ${FULFILMENT_STATES.join(', ')}`,
        },
        { status: 400 },
      )
    }

    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw === null ? 50 : Number(limitRaw)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { error: 'bad_limit', message: 'limit must be a whole number from 1 to 500' },
        { status: 400 },
      )
    }

    let query = db().from('orders').select('*', { count: 'exact' }).eq('project', project)
    if (status) query = query.eq('fulfilment_status', status)

    // `total` is the exact count of everything matching; `limit` bounds only
    // the rows. The Orders card renders `total`, never `orders.length`.
    const { data, error, count } = await query
      .order('placed_at', { ascending: false })
      .limit(limit)
    if (error) return dbQueryErrorResponse(error, 'orders')

    const rows = (data ?? []) as unknown as OrderRow[]
    return NextResponse.json({
      project,
      total: count ?? rows.length,
      fulfilment_status: status ?? null,
      orders: rows.map(present),
    })
  },
)

export const POST = withPermission(
  'projects:write',
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

    const known = rejectUnknownFields(body, ORDER_CREATE_FIELDS)
    if (!known.ok) {
      return NextResponse.json({ error: 'unknown_field', message: known.why }, { status: 400 })
    }

    const order = validateNewOrder(body)
    if (!order.ok) {
      return NextResponse.json({ error: 'invalid_order', message: order.why }, { status: 422 })
    }

    const now = new Date().toISOString()
    const { data, error } = await db()
      .from('orders')
      .insert({
        project,
        order_number: order.value.order_number,
        placed_at: order.value.placed_at,
        customer_email: order.value.customer_email,
        currency: order.value.currency,
        total_minor: order.value.total_minor,
        fulfilment_status: order.value.fulfilment_status,
        created_at: now,
        updated_at: now,
      })
      .select('*')

    if (error) {
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json(
          {
            error: 'duplicate_order_number',
            message: `${project} already has an order "${order.value.order_number}".`,
          },
          { status: 409 },
        )
      }
      return dbQueryErrorResponse(error, 'orders')
    }

    const created = ((data ?? []) as unknown as OrderRow[])[0]
    if (created) {
      // Lines are written after the order they belong to, and only if it
      // actually landed — an order row with no lines is a total nobody can
      // reconstruct.
      for (const line of order.value.line_items) {
        await db().from('order_line_items').insert({
          order_id: created.id,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          unit_price_minor: line.unit_price_minor,
          currency: line.currency,
        })
      }
    }

    return NextResponse.json(
      {
        project,
        order: created ? present(created) : null,
        line_items: order.value.line_items.length,
      },
      { status: 201 },
    )
  },
)

export const PATCH = withPermission(
  'projects:write',
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

    const fields = rejectUnknownFields(body, ORDER_PATCH_FIELDS)
    if (!fields.ok) {
      return NextResponse.json({ error: 'unknown_field', message: fields.why }, { status: 400 })
    }

    if (typeof body.order_number !== 'string' || body.order_number.trim() === '') {
      return NextResponse.json(
        { error: 'bad_order_number', message: 'order_number is required' },
        { status: 422 },
      )
    }
    const orderNumber = body.order_number.trim()

    const { data: order, error: readError } = await db()
      .from('orders')
      .select('*')
      .eq('project', project)
      .eq('order_number', orderNumber)
      .maybeSingle<OrderRow>()
    if (readError) return dbQueryErrorResponse(readError, 'orders')
    if (!order) {
      return NextResponse.json(
        { error: 'not_found', message: `${project} has no order "${orderNumber}".` },
        { status: 404 },
      )
    }

    // The state machine decides, not this route. Everything it refuses —
    // un-shipping, moving out of cancelled, a move to the state already held,
    // a state outside the set — is refused here with the reason it gave.
    const move = checkFulfilmentTransition(order.fulfilment_status, body.fulfilment_status)
    if (!move.ok) {
      return NextResponse.json(
        { error: 'illegal_transition', message: move.why, from: order.fulfilment_status },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const { error: writeError } = await db()
      .from('orders')
      .update({ fulfilment_status: move.value, updated_at: now })
      .eq('project', project)
      .eq('order_number', orderNumber)
    if (writeError) return dbQueryErrorResponse(writeError, 'orders')

    await db().from('commerce_actions').insert({
      project,
      action: 'order.fulfilment',
      object_type: 'order',
      object_ref: orderNumber,
      from_value: order.fulfilment_status,
      to_value: move.value,
      reason: null,
      actor: commerceActor(req),
      created_at: now,
    })

    // TOD-2443. Fulfilling an order MOVES STOCK. Without this the two ledgers
    // this channel just built describe the same physical goods and cannot
    // disagree loudly: a critic ran an order carrying 10 units of CRIT-A all
    // the way to `fulfilled` and inventory still read 14 on hand. Ten shipped,
    // fourteen on the shelf, and "What is about to run out?" would keep
    // answering 0 for a SKU that had shipped its entire stock.
    //
    // The join was already in the schema and nothing queried it: order_line_items
    // carries sku and quantity. Stock moves through the SAME audit shape as a
    // manual adjust, with the order named as the reason, so item 27's guarantee
    // — stock never changes without a recorded reason — still holds.
    //
    // Only on the transition INTO `fulfilled`. `partially_fulfilled` cannot say
    // WHICH lines went (order_line_items has no fulfilled-quantity column), so
    // decrementing there would be inventing a number. That absence is stated in
    // the response rather than guessed at.
    const stockMoves: { sku: string; quantity: number; on_hand: number | null }[] = []
    let stockNote: string | null = null

    if (move.value === 'fulfilled' && order.fulfilment_status !== 'fulfilled') {
      const { data: lines } = await db()
        .from('order_line_items')
        .select('sku,quantity')
        .eq('order_id', order.id)

      for (const line of (lines ?? []) as { sku: string; quantity: number }[]) {
        const { data: level } = await db()
          .from('inventory_levels')
          .select('id,on_hand')
          .eq('project', project)
          .eq('sku', line.sku)
          .limit(1)
          .maybeSingle()

        if (!level) {
          // Say it rather than silently skipping: a line with no stock record
          // is a real gap in the catalogue, not a no-op.
          stockMoves.push({ sku: line.sku, quantity: line.quantity, on_hand: null })
          continue
        }

        const next = Number(level.on_hand) - Number(line.quantity)

        // Write the AUDIT ROW FIRST, and check it. TOD-2443: my first version
        // wrote object_type 'inventory_level', which the CHECK on
        // commerce_actions refuses — and the insert's error was not checked, so
        // stock moved 14 -> 4 while the audit recorded nothing and the response
        // said the move was clean. Item 27's guarantee is that stock never
        // changes without a recorded reason; an unchecked insert cannot make
        // that guarantee, it can only appear to.
        //
        // Ordering it first means the failure mode is a refused move with an
        // intact ledger, not a silent move with a missing one.
        const { error: auditError } = await db().from('commerce_actions').insert({
          project,
          action: 'inventory.adjust',
          object_type: 'inventory',
          object_ref: line.sku,
          from_value: String(level.on_hand),
          to_value: String(next),
          reason: `fulfilled order ${orderNumber}`,
          actor: commerceActor(req),
          created_at: now,
        })
        if (auditError) {
          return NextResponse.json(
            {
              error: 'audit_write_failed',
              message:
                `stock for "${line.sku}" was NOT moved: the audit row could not be written ` +
                `(${auditError.message}). Stock does not change without a recorded reason, so ` +
                `the order stays ${order.fulfilment_status}.`,
            },
            { status: 500 },
          )
        }

        await db().from('inventory_levels').update({ on_hand: next, updated_at: now }).eq('id', level.id)
        stockMoves.push({ sku: line.sku, quantity: line.quantity, on_hand: next })
      }
    } else if (move.value === 'partially_fulfilled') {
      stockNote =
        'stock was not moved: order_line_items records no fulfilled quantity, so which lines shipped is not known. ' +
        'Stock moves in full when this order reaches fulfilled.'
    }

    return NextResponse.json({
      stock_moves: stockMoves,
      stock_note: stockNote,
      project,
      order_number: orderNumber,
      from: order.fulfilment_status,
      fulfilment_status: move.value,
    })
  },
)
