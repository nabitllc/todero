/**
 * Orders — commerce-operations piece (Wave 7; partial fulfilment added Wave 8).
 *
 *   GET   /api/commerce/orders                               -> { project, total, orders }
 *   GET   /api/commerce/orders?fulfilment_status=unfulfilled -> filtered
 *   GET   /api/commerce/orders?order_number=LG-1001          -> one order, with its line items,
 *                                                               each carrying fulfilled/remaining
 *   POST  /api/commerce/orders                               -> ingest one order with its lines
 *   PATCH /api/commerce/orders                               -> SHIP units, or move the state (the action)
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
 * ─── PARTIAL FULFILMENT: THE GAP THIS ROUTE USED TO NAME AND NOT CLOSE ─────
 *
 *   Until migration 074 this handler contained, in so many words, an admission:
 *
 *     "`partially_fulfilled` cannot say WHICH lines went (order_line_items has
 *      no fulfilled-quantity column), so decrementing there would be inventing
 *      a number."
 *
 *   Measured against the running server before 074 — an order of 10 x PF8-A
 *   and 4 x PF8-B, then PATCH {fulfilment_status: 'partially_fulfilled'}:
 *
 *     HTTP 200, stock_moves: [], stock_note: "stock was not moved…",
 *     and GET /api/commerce/inventory still read PF8-A 100, PF8-B 100.
 *
 *   The refusal was honest. What it was covering for was a missing OBJECT, not
 *   a missing report: nowhere in the schema could the two facts a partial
 *   shipment consists of — which line, how many units — be written down.
 *   Migration 074 adds `order_line_items.fulfilled_quantity`, and this route is
 *   what moves it.
 *
 *   PATCH now takes `line_fulfilments`:
 *
 *     PATCH { order_number: "LG-1001",
 *             line_fulfilments: [ { sku: "PF8-A", quantity: 4 } ] }
 *
 *   and answers with what each line now stands at, what stock moved, and the
 *   order's DERIVED fulfilment status.
 *
 * ─── ONE WRITER, TWO ENTRY POINTS ─────────────────────────────────────────
 *
 *   `{fulfilment_status: "fulfilled"}` with no `line_fulfilments` is not a
 *   second implementation. It is compiled into the same per-line plan — "ship
 *   everything still outstanding on every line" — and run through the same
 *   writer. That is what makes the following true rather than merely intended:
 *
 *     A line that already shipped 4 of 10 and is then marked fulfilled moves
 *     SIX units of stock, not ten.
 *
 *   The old code decremented `line.quantity` unconditionally. Adding partial
 *   fulfilment on top of that, without unifying, would have shipped the same
 *   units twice — the exact double-ship class of bug this channel already found
 *   and fixed once at the order level. Outstanding-not-ordered is the whole
 *   reason the two paths are one path.
 *
 * ─── THE STATUS IS DERIVED, NEVER ASSERTED ────────────────────────────────
 *
 *   `deriveFulfilmentStatus()` (lib/commerce.ts) computes the order's state
 *   from its lines. A caller may still SEND `fulfilment_status` alongside
 *   `line_fulfilments`, and if it disagrees with what the lines say, the whole
 *   request is refused naming both — the same stance `validateNewOrder` takes
 *   when a stated total disagrees with the sum of its lines. Two independent
 *   opinions about one fact is what a reconciliation failure is made of.
 *
 *   THAT SENTENCE USED TO BE HALF TRUE, and the half it was false about was
 *   this file's own POST. Ingest asserted the status and wrote every line at 0,
 *   so `POST {fulfilment_status:'partially_fulfilled', line_items:[{quantity:5}]}`
 *   answered 201 and stored an order recorded as part-shipped with every unit
 *   still on the shelf — the state PATCH refuses in so many words. Ingest now
 *   derives too: a line may state `fulfilled_quantity`, `fulfilment_status:
 *   'fulfilled'` stays the "all of it" shorthand, `cancelled` is the one
 *   exemption (it is not a count of anything), and a stated status that
 *   disagrees with the quantities is refused at the door.
 *
 *   AND THERE IS A WAY BACK. `PATCH {order_number, fulfilment_status: <what the
 *   lines already say>}` with no `line_fulfilments` SETTLES an order whose
 *   status has fallen behind its own lines: it moves no units, writes one audit
 *   row, and still derives the answer from the lines rather than taking the
 *   caller's word for it. Two of this handler's own 500s printed advice to
 *   "re-send this PATCH with no line_fulfilments" long before that request
 *   existed — measured, it was refused four ways out of four.
 *
 *   One consequence, called out because it is a deliberate BREAKING change to a
 *   previously-200 request: `{fulfilment_status: "partially_fulfilled"}` with
 *   no `line_fulfilments` is now REFUSED (422). It used to succeed and produce
 *   exactly the incoherent state above — an order the operator had been told
 *   was partly shipped, with every unit still on the shelf and no record of
 *   which parcel left. There is now a way to say what shipped, so asserting the
 *   status without saying it is no longer an honest option.
 *
 * ─── CONCURRENCY: THE CLAIM IS THE LINE, NOT THE ORDER ────────────────────
 *
 *   The order-status compare-and-swap this file already had cannot protect a
 *   partial shipment: two concurrent partial ships both read
 *   `partially_fulfilled` and both write `partially_fulfilled`, so the CAS
 *   matches for both and neither is refused. The exclusive claim has to be
 *   taken where the contention actually is — on the LINE:
 *
 *     UPDATE order_line_items
 *        SET fulfilled_quantity = <read + q>
 *      WHERE id = <line> AND fulfilled_quantity = <the value just read>
 *
 *   One statement, so only one of N racing callers can win it. A loser re-reads
 *   and RE-CHECKS its request against the new value (the units it wanted may
 *   have just been taken by the winner), bounded at 8 attempts, exactly as
 *   `inventory/route.ts`'s PATCH handler does for `on_hand`.
 *
 *   ORDERING, AND WHY IT CHANGED: the previous handler claimed the ORDER's
 *   status first and moved stock afterwards, which produced a documented
 *   residual inconsistency — under contention an order could end up recorded as
 *   `fulfilled` while its stock never moved (measured: 20 orders on one SKU,
 *   `{200: 9, 409: 11}`, and the 11 refusals were all already marked fulfilled).
 *   The order now goes LAST: lines are claimed, stock moves, audit rows land,
 *   and only then is the order's status reconciled to whatever the lines
 *   actually say — in its own bounded CAS loop, since a concurrent shipment may
 *   have moved the status in the meantime. A shipment that cannot complete
 *   reverts its own line claim and leaves the order's status untouched — which
 *   was written here one round before it was true of EVERY exit: a failed stock
 *   read and a failed stock write both returned the driver's error straight out
 *   with the claim still standing, so an ordinary oversell (CHECK on_hand >= 0)
 *   left a line recording units nothing had shipped. Both now compensate, and
 *   an oversell is refused with numbers before anything is claimed at all.
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
  type FulfilmentStatus,
  type LineFulfilmentRequest,
  type OrderLineState,
  type PlannedLineFulfilment,
  canFulfilmentTransition,
  checkFulfilmentTransition,
  checkStatedStatusAgainstLines,
  deriveFulfilmentStatus,
  formatMinor,
  isFulfilmentStatus,
  lineRemaining,
  planLineFulfilments,
  rejectUnknownFields,
  validateLineFulfilments,
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
  fulfilled_quantity: number
  unit_price_minor: number
  currency: string
}

const ORDER_PATCH_FIELDS = ['order_number', 'fulfilment_status', 'line_fulfilments', 'project'] as const

/** Bounded retry budget for every compare-and-swap loop in this file. Kept at
 *  the same 8 `inventory/route.ts` uses and has measurements for, rather than
 *  introducing a second, untested ceiling. */
const MAX_ATTEMPTS = 8

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

/** Read one order's lines at their freshest values, for planning or reporting. */
async function readLineStates(orderId: string) {
  const { data, error } = await db()
    .from('order_line_items')
    .select('id,sku,quantity,fulfilled_quantity')
    .eq('order_id', orderId)
  return { rows: (data ?? []) as unknown as OrderLineState[], error }
}

/**
 * Compare-and-swap a line's `fulfilled_quantity` back to a previous value.
 * Returns whether the revert actually landed — a `false` here is a real
 * divergence and is always reported to the caller in words, never swallowed.
 */
async function revertLineClaim(lineId: string, from: number, to: number): Promise<boolean> {
  const { data, error } = await db()
    .from('order_line_items')
    .update({ fulfilled_quantity: to })
    .eq('id', lineId)
    .eq('fulfilled_quantity', from)
    .select('*')
  return !error && ((data ?? []) as unknown[]).length > 0
}

interface LevelRow {
  id: string
  on_hand: number
  location: string
}

/**
 * One SKU's stock levels in a FIXED order.
 *
 * `inventory_levels` is UNIQUE (project, sku, location) and the adjust endpoint
 * has taken a `location` since 064, so a SKU really can have several rows. This
 * writer used to read them with `.limit(1).maybeSingle()` and no ORDER BY,
 * which means the shelf a parcel came off was whatever the driver happened to
 * return first — a decision nobody made, that could differ between two
 * identical requests and between the two dialects. Sorting by location makes it
 * a decision: lowest location name first, the same one twice.
 */
function sortLevels(rows: unknown): LevelRow[] {
  return ((rows ?? []) as LevelRow[])
    .map(r => ({ id: r.id, on_hand: Number(r.on_hand), location: String(r.location ?? 'default') }))
    .sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0))
}

/**
 * The level this shipment takes its units from: the first, in that fixed order,
 * that can cover the WHOLE quantity on its own. `null` when none can.
 *
 * A line is deliberately never split across locations. Taking 3 off one shelf
 * and 2 off another is a transfer decision with a real cost attached, and this
 * endpoint gives an operator no way to say which shelf they meant — so it
 * refuses and says so, rather than choosing for them.
 */
function pickLevelFor(levels: LevelRow[], quantity: number): LevelRow | null {
  return levels.find(l => l.on_hand >= quantity) ?? null
}

/** Why the shelf cannot cover this, with the numbers an operator needs next. */
function describeShortfall(project: string, sku: string, quantity: number, levels: LevelRow[]): string {
  const total = levels.reduce((n, l) => n + l.on_hand, 0)
  if (levels.length === 1) {
    return (
      `shipping ${quantity} of "${sku}" needs ${quantity} on hand, and ${project} has ${total} at location ` +
      `"${levels[0].location}". Ship at most ${total}, or add the missing ${quantity - total} first with ` +
      `PATCH /api/commerce/inventory {"sku":"${sku}","delta":${quantity - total},"reason":"..."}.`
    )
  }
  const most = Math.max(...levels.map(l => l.on_hand))
  return (
    `shipping ${quantity} of "${sku}" needs ${quantity} in ONE location, and no location in ${project} holds ` +
    `that many (${levels.map(l => `${l.location}: ${l.on_hand}`).join(', ')}; ${total} in total). A line is ` +
    `not split across locations here — the shipment records which shelf the parcel came off, and taking ` +
    `part of it from each is a transfer somebody has to decide. Move the stock together with ` +
    `PATCH /api/commerce/inventory, or ship at most ${most}.`
  )
}

/**
 * The sentence every failure AFTER a line claim owes its caller: what was
 * claimed, whether giving it back landed, and therefore what is true now.
 *
 * THE DEFECT THIS EXISTS TO STOP REPEATING. Two paths in the stock loop below
 * — a failed level READ and a failed level WRITE — used to
 * `return dbQueryErrorResponse(...)` straight out, AFTER the per-line claim had
 * landed and without reverting it. Measured on the running server (2026-08-26):
 * shipping 5 units of a SKU with 2 on hand answered
 * `500 {"error":"CHECK constraint failed: on_hand >= 0"}` — the driver's own
 * string, with no `message` field — and left the line reading 5 of 5
 * fulfilled with the stock untouched, the order still `unfulfilled`, and no
 * commerce_actions row: five units recorded as shipped with no audit trail and
 * no way back through this API. Every path out of that loop now goes through a
 * revert and says which of the two outcomes it got.
 */
function claimRevertNote(from: number, to: number, landed: boolean): string {
  return landed
    ? `The line claim (${from} -> ${to}) was reverted, so this line is unchanged and the order was not touched.`
    : `The line claim (${from} -> ${to}) could NOT be reverted — its own compensating write lost a race, ` +
        `so this line now reads as shipped while its stock did not move, and needs manual reconciliation.`
}

/**
 * Make the order's own status agree with what its lines ALREADY say, moving no
 * units. Returns `null` when there is nothing to reconcile, so the caller falls
 * through to its own refusal.
 *
 * WHY THIS EXISTS: this route printed remediation text naming a request that did
 * not exist. Two of its 500s said to "re-send this PATCH with no
 * line_fulfilments" to settle an order whose lines had shipped but whose status
 * had been reverted or could not be settled. Measured: every form of that
 * request was refused — `{order_number}` alone 422 nothing_to_do,
 * `+ fulfilment_status:'fulfilled'` 409 nothing_to_ship,
 * `+ 'partially_fulfilled'` 422 needs_line_fulfilments, a zero-quantity line
 * 422 — and the order stayed wrong. The advice was the fabrication; the
 * missing settle path was the defect underneath it.
 *
 * It is a DERIVE, not an assert: the caller does not get to say what the status
 * becomes, the lines do. A caller that names a status it does not agree with
 * gets the same `status_disagrees_with_lines` refusal as everywhere else,
 * because it never reaches here.
 */
async function reconcileStatusToLines(
  project: string,
  orderNumber: string,
  order: OrderRow,
  lines: OrderLineState[],
  actor: string,
): Promise<NextResponse | null> {
  // An order with no lines has no fact to reconcile TO, and a terminal order is
  // not something a settle may quietly move.
  if (lines.length === 0) return null
  if (order.fulfilment_status === 'fulfilled' || order.fulfilment_status === 'cancelled') return null

  const target = deriveFulfilmentStatus(lines)
  if (target === order.fulfilment_status) return null
  if (!canFulfilmentTransition(order.fulfilment_status, target)) return null

  const detail = lines.map(l => `${l.sku}: ${l.fulfilled_quantity}/${l.quantity}`).join(', ')
  const now = new Date().toISOString()
  const { data: moved, error: writeError } = await db()
    .from('orders')
    .update({ fulfilment_status: target, updated_at: now })
    .eq('project', project)
    .eq('order_number', orderNumber)
    .eq('fulfilment_status', order.fulfilment_status)
    .select('*')
  if (writeError) return dbQueryErrorResponse(writeError, 'orders')
  if (((moved ?? []) as unknown[]).length === 0) {
    return NextResponse.json(
      {
        error: 'conflict',
        message:
          `${orderNumber} was moved out of ${order.fulfilment_status} by a concurrent request while its ` +
          `status was being settled. Nothing was changed here; re-read the order.`,
      },
      { status: 409 },
    )
  }

  const { error: auditError } = await db().from('commerce_actions').insert({
    project,
    action: 'order.fulfilment',
    object_type: 'order',
    object_ref: orderNumber,
    from_value: order.fulfilment_status,
    to_value: target,
    reason: `status settled to what the lines already said (${detail}); no units moved`,
    actor,
    created_at: now,
  })
  if (auditError) {
    const { data: reverted, error: revertError } = await db()
      .from('orders')
      .update({ fulfilment_status: order.fulfilment_status, updated_at: new Date().toISOString() })
      .eq('project', project)
      .eq('order_number', orderNumber)
      .eq('fulfilment_status', target)
      .select('*')
    const revertLanded = !revertError && ((reverted ?? []) as unknown[]).length > 0
    return NextResponse.json(
      {
        error: revertLanded ? 'audit_write_failed' : 'audit_write_failed_unreconciled',
        message:
          `${orderNumber}'s status was NOT settled: the audit row could not be written ` +
          `(${auditError.message}). The status change (${order.fulfilment_status} -> ${target}) ` +
          `${revertLanded ? 'was reverted' : 'could NOT be reverted, and needs manual reconciliation'}. ` +
          `No units moved either way.`,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    project,
    order_number: orderNumber,
    from: order.fulfilment_status,
    fulfilment_status: target,
    status_settled_from: order.fulfilment_status,
    status_note:
      `no units moved: ${orderNumber}'s lines already read ${detail}, which makes the order ${target}, and ` +
      `its status was ${order.fulfilment_status}. The status was settled to what the lines say.`,
    lines: [],
    stock_moves: [],
    stock_note: null,
  })
}

/** The same, for a stock level. */
async function revertStock(levelId: string, from: number, to: number): Promise<boolean> {
  const { data, error } = await db()
    .from('inventory_levels')
    .update({ on_hand: to, updated_at: new Date().toISOString() })
    .eq('id', levelId)
    .eq('on_hand', from)
    .select('*')
  return !error && ((data ?? []) as unknown[]).length > 0
}

export const GET = withPermission(
  'commerce:read',
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
      // THE ERROR IS CHECKED, and this is the whole point of the read.
      //
      // This used to be `const { data: lines } = await ...` with no `error`
      // destructured, and `(lines ?? [])` right after it. That coercion turned
      // a driver failure into an EMPTY ORDER: HTTP 200, `line_items: []`, and
      // `fulfilment: {ordered: 0, fulfilled: 0, remaining: 0}` for an order
      // holding unshipped units. An operator reading "nothing outstanding" off
      // a failed query is worse off than one reading an error, because the
      // first number is actionable and wrong.
      //
      // It also defeated the client that was written to handle exactly this:
      // components/tabs/CommerceTab.tsx:189-199 branches on `!res.ok` and its
      // comment promises "never render an empty line list over a failed
      // request". That branch was CORRECT AND UNREACHABLE — the server never
      // gave it a non-ok status to see. A guarantee the client cannot enforce
      // alone has to be kept on the server.
      const { data: lines, error: linesError } = await db()
        .from('order_line_items')
        .select('*')
        .eq('order_id', data.id)
      if (linesError) return dbQueryErrorResponse(linesError, 'order_line_items')
      const rows = (lines ?? []) as unknown as LineRow[]

      // `line_id` is returned because it is the only unambiguous way to address
      // a line in PATCH's `line_fulfilments` when an order carries the same SKU
      // twice. A caller cannot be told to use an identifier no read hands it.
      return NextResponse.json({
        project,
        order: present(data),
        fulfilment: {
          ordered: rows.reduce((n, l) => n + l.quantity, 0),
          fulfilled: rows.reduce((n, l) => n + (l.fulfilled_quantity ?? 0), 0),
          remaining: rows.reduce((n, l) => n + lineRemaining(l), 0),
        },
        line_items: rows.map(l => ({
          line_id: l.id,
          sku: l.sku,
          title: l.title,
          quantity: l.quantity,
          fulfilled_quantity: l.fulfilled_quantity ?? 0,
          remaining: lineRemaining(l),
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
    let linesStored = 0
    if (created) {
      // Lines are written after the order they belong to, and only if it
      // actually landed — an order row with no lines is a total nobody can
      // reconstruct.
      //
      // WHAT EACH LINE ARRIVED WITH is decided in `validateNewOrder`, not here.
      // This loop used to make that decision itself, with
      // `ingestFulfilled ? line.quantity : 0` - which is how an order could be
      // ingested `partially_fulfilled` with every line at 0, storing exactly
      // the disagreement between a status and its own lines that PATCH refuses
      // to create. Ingest now derives its status from the quantities (or
      // writes the quantities from the `fulfilled` shorthand), and this loop
      // only records what that decided.
      //
      // EACH INSERT'S ERROR IS CHECKED, and `landed` counts what the database
      // accepted rather than what the request asked for. Before this, the loop
      // discarded every result and the 201 below reported
      // `line_items: order.value.line_items.length` — a count read off the
      // REQUEST. A failing line insert therefore produced `201 {line_items: 3}`
      // for an order that had stored one line, or none: the order's total says
      // one thing, its lines say another, and the ingesting system has a
      // written receipt saying all three arrived. That is silent data loss with
      // a confirmation attached, and it made the comment above — "only if it
      // actually landed" — an assertion this code did not keep.
      let landed = 0
      for (const line of order.value.line_items) {
        const { error: lineError } = await db().from('order_line_items').insert({
          order_id: created.id,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          fulfilled_quantity: line.fulfilled_quantity,
          unit_price_minor: line.unit_price_minor,
          currency: line.currency,
        })
        if (lineError) {
          // The order row is already committed and there is no transaction
          // spanning it, so this cannot be undone into a clean "nothing
          // happened". Say exactly what exists, so the half-order is
          // reconcilable instead of merely wrong. 500, never 201: the caller
          // must not record this ingest as complete.
          return NextResponse.json(
            {
              error: 'order_lines_write_failed',
              message:
                `${order.value.order_number} was created but its lines were NOT fully stored: ` +
                `line ${landed + 1} of ${order.value.line_items.length} ("${line.sku}") failed to ` +
                `write (${lineError.message}). ${landed} line${landed === 1 ? '' : 's'} landed. ` +
                `The order's total (${formatMinor(order.value.total_minor, order.value.currency)} ` +
                `${order.value.currency}) does not match its stored lines. Delete the order and ` +
                `re-ingest it, or add the missing lines, before shipping anything against it.`,
              order_number: order.value.order_number,
              lines_expected: order.value.line_items.length,
              lines_stored: landed,
            },
            { status: 500 },
          )
        }
        landed += 1
      }
      linesStored = landed
    }

    // A 201 with `order: null` is not a created order.
    //
    // `created` is falsy when the insert reported NO error and returned NO row
    // — a real driver outcome (a suppressed RETURNING, a row filtered by a
    // policy). The `if (created)` block above is then skipped entirely, so not
    // one line is written either; the old code still answered
    // `201 {order: null, line_items: <length of the request>}`. An importer
    // reading that records the order as ingested and never sends it again.
    //
    // Found by mutating the line count back to the request's length and
    // noticing the mutation SURVIVED — the count is unobservable on every path
    // that reaches this line except this one, which is precisely the path that
    // should never have reached it.
    if (!created) {
      return NextResponse.json(
        {
          error: 'order_write_unconfirmed',
          message:
            `${order.value.order_number} could not be confirmed: the insert reported no error but ` +
            `returned no row, so nothing here can say whether the order exists. No line items were ` +
            `written. Re-read the order before retrying — a retry will be refused as a duplicate if ` +
            `it did land.`,
          order_number: order.value.order_number,
        },
        { status: 500 },
      )
    }

    return NextResponse.json(
      {
        project,
        order: present(created),
        // What the DATABASE took, not what the request offered.
        line_items: linesStored,
      },
      { status: 201 },
    )
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

    if (body.fulfilment_status === undefined && body.line_fulfilments === undefined) {
      return NextResponse.json(
        {
          error: 'nothing_to_do',
          message:
            'send line_fulfilments (which lines shipped, and how many) or fulfilment_status (a move on the ' +
            'order as a whole). A PATCH that says neither would change nothing.',
        },
        { status: 422 },
      )
    }

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

    const actor = commerceActor(req)

    // WHICH OF THE TWO SHAPES IS THIS?
    //   * explicit  — `line_fulfilments` given: ship exactly those quantities.
    //   * implicit  — `fulfilment_status: "fulfilled"` alone: ship everything
    //                 still outstanding on every line. Compiled into the same
    //                 plan and run by the same writer, which is what makes
    //                 "ships the OUTSTANDING amount, not the ordered amount"
    //                 true by construction rather than by a second code path
    //                 someone has to remember to keep in step.
    //   * neither   — a status-only move (`cancelled`), handled below.
    const explicitLines = body.line_fulfilments !== undefined
    const shipsUnits = explicitLines || body.fulfilment_status === 'fulfilled'

    // ─── Status-only moves ──────────────────────────────────────────────────
    if (!shipsUnits) {
      // BREAKING, DELIBERATELY. This used to answer 200 and produce an order
      // recorded as partly shipped with zero stock moved and no record of what
      // went — see this file's header for the measurement. Now that
      // `fulfilled_quantity` exists, there IS a way to say what shipped, so
      // asserting the status without saying it is no longer an honest option.
      if (body.fulfilment_status === 'partially_fulfilled') {
        // ...UNLESS the lines already say partially_fulfilled and the order
        // does not. That request is not an assertion, it is a SETTLE: the
        // caller is asking for the order's status to be brought into line with
        // quantities that are already recorded, and the answer still comes from
        // the lines, not from the caller. Without this, an order whose status
        // change lost its audit row (see the 500s at the end of this handler)
        // had no way back through this API at all — measured, four refusals
        // out of four.
        const { rows: settleLines, error: settleLinesError } = await readLineStates(order.id)
        if (settleLinesError) return dbQueryErrorResponse(settleLinesError, 'order_line_items')
        const settled = await reconcileStatusToLines(project, orderNumber, order, settleLines, actor)
        if (settled) return settled

        return NextResponse.json(
          {
            error: 'needs_line_fulfilments',
            message:
              `partially_fulfilled cannot be asserted on its own — say which lines shipped and how many, ` +
              `with line_fulfilments: [{ sku or line_id, quantity }]. The status is then derived from those ` +
              `quantities. Until migration 074 this request succeeded and moved no stock, which left the ` +
              `order claiming a shipment nothing recorded. GET /api/commerce/orders?order_number=` +
              `${orderNumber} lists each line with its line_id and how many remain. (This same request DOES ` +
              `settle the status, moving no units, when the lines already record a partial shipment and only ` +
              `the order's own status is behind them — here they do not.)`,
          },
          { status: 422 },
        )
      }

      const move = checkFulfilmentTransition(order.fulfilment_status, body.fulfilment_status)
      if (!move.ok) {
        return NextResponse.json(
          { error: 'illegal_transition', message: move.why, from: order.fulfilment_status },
          { status: 409 },
        )
      }

      const now = new Date().toISOString()
      const { data: claimed, error: writeError } = await db()
        .from('orders')
        .update({ fulfilment_status: move.value, updated_at: now })
        .eq('project', project)
        .eq('order_number', orderNumber)
        .eq('fulfilment_status', order.fulfilment_status)
        .select('*')
      if (writeError) return dbQueryErrorResponse(writeError, 'orders')
      if (((claimed ?? []) as unknown[]).length === 0) {
        return NextResponse.json(
          {
            error: 'conflict',
            message:
              `${orderNumber} was already moved to a different fulfilment state by a concurrent request. ` +
              `Nothing was changed here; re-read the order and retry if the move is still correct.`,
          },
          { status: 409 },
        )
      }

      const { error: auditError } = await db().from('commerce_actions').insert({
        project,
        action: 'order.fulfilment',
        object_type: 'order',
        object_ref: orderNumber,
        from_value: order.fulfilment_status,
        to_value: move.value,
        reason: null,
        actor,
        created_at: now,
      })
      if (auditError) {
        const { data: reverted, error: revertError } = await db()
          .from('orders')
          .update({ fulfilment_status: order.fulfilment_status, updated_at: new Date().toISOString() })
          .eq('project', project)
          .eq('order_number', orderNumber)
          .eq('fulfilment_status', move.value)
          .select('*')
        if (!revertError && ((reverted ?? []) as unknown[]).length > 0) {
          return NextResponse.json(
            {
              error: 'audit_write_failed',
              message:
                `${orderNumber} was NOT moved: the audit row could not be written (${auditError.message}), ` +
                `and the fulfilment_status change was reverted (${order.fulfilment_status} -> ${move.value} -> ` +
                `${order.fulfilment_status}). No stock was touched. Retry.`,
            },
            { status: 500 },
          )
        }
        return NextResponse.json(
          {
            error: 'audit_write_failed_unreconciled',
            message:
              `${orderNumber} moved to fulfilment_status=${move.value} but the audit row could not be written ` +
              `(${auditError.message}), AND the compensating revert lost its own race against a concurrent ` +
              `writer. The order and its audit trail have diverged and need manual reconciliation — this db seam ` +
              `has no cross-table transaction on either dialect, so this handler cannot guarantee atomicity here.`,
          },
          { status: 500 },
        )
      }

      return NextResponse.json({
        stock_moves: [],
        stock_note:
          move.value === 'cancelled'
            ? 'no stock was moved: cancelling an order does not return units to the shelf. Units that already ' +
              'shipped are gone, and units that never shipped were never decremented. If a parcel is coming ' +
              'back, that is a RETURN, and it is a stock adjustment with its own reason.'
            : null,
        project,
        order_number: orderNumber,
        from: order.fulfilment_status,
        fulfilment_status: move.value,
        lines: [],
      })
    }

    // ─── Shipping units ─────────────────────────────────────────────────────

    // Terminal states first, so the refusal is the state machine's own words
    // rather than a pile of per-line over-fulfilment messages.
    if (order.fulfilment_status === 'fulfilled' || order.fulfilment_status === 'cancelled') {
      return NextResponse.json(
        {
          error: 'illegal_transition',
          message:
            `${orderNumber} is ${order.fulfilment_status}, which is final — no further units can ship against ` +
            `it. ${order.fulfilment_status === 'fulfilled'
              ? 'Every line has already gone; a parcel that left is a RETURN, which is a different object.'
              : 'A cancelled order ships nothing.'}`,
          from: order.fulfilment_status,
        },
        { status: 409 },
      )
    }

    const { rows: lineStates, error: linesError } = await readLineStates(order.id)
    if (linesError) return dbQueryErrorResponse(linesError, 'order_line_items')

    let requests: LineFulfilmentRequest[]
    if (explicitLines) {
      const parsed = validateLineFulfilments(body.line_fulfilments)
      if (!parsed.ok) {
        return NextResponse.json({ error: 'invalid_line_fulfilments', message: parsed.why }, { status: 422 })
      }
      requests = parsed.value
    } else {
      // Implicit: everything still outstanding. Addressed by `line_id` and not
      // by sku, so an order carrying the same SKU on two lines is shipped
      // correctly instead of being refused as ambiguous.
      requests = lineStates
        .filter(l => lineRemaining(l) > 0)
        .map(l => ({ sku: null, line_id: l.id, quantity: lineRemaining(l) }))
      if (requests.length === 0) {
        // Nothing remains to ship. If the ORDER's status is nevertheless behind
        // its lines, that is the settle above, not a refusal: this is the exact
        // request the audit-failure remediation at the end of this handler
        // names, and it used to answer 409 and leave the order wrong.
        const settled = await reconcileStatusToLines(project, orderNumber, order, lineStates, actor)
        if (settled) return settled

        return NextResponse.json(
          {
            error: 'nothing_to_ship',
            message:
              lineStates.length === 0
                ? `${orderNumber} has no line items, so there is nothing to ship. An order with no lines is a ` +
                  `total nobody can reconstruct — it needs fixing at ingest, not fulfilling.`
                : `every line on ${orderNumber} has already shipped in full ` +
                  `(${lineStates.map(l => `${l.sku}: ${l.fulfilled_quantity}/${l.quantity}`).join(', ')}), ` +
                  `so there is nothing left to ship and nothing was moved. The order reads ` +
                  `${order.fulfilment_status}, which those lines agree with, so there is no status to settle ` +
                  `either — re-read the order.`,
          },
          { status: 409 },
        )
      }
    }

    const plan = planLineFulfilments(lineStates, requests)
    if (!plan.ok) {
      return NextResponse.json({ error: 'invalid_line_fulfilments', message: plan.why }, { status: 422 })
    }

    // What the lines WOULD say if this whole plan lands. Used only to check a
    // stated status against; the status actually written at the end is derived
    // from a fresh read, because other writers exist.
    const projected = lineStates.map(l => {
      const move = plan.value.find((p: PlannedLineFulfilment) => p.line.id === l.id)
      return { quantity: l.quantity, fulfilled_quantity: move ? move.next_fulfilled : l.fulfilled_quantity }
    })
    const projectedStatus = deriveFulfilmentStatus(projected)

    if (body.fulfilment_status !== undefined) {
      const detail = projected
        .map((p, i) => `${lineStates[i].sku}: ${p.fulfilled_quantity}/${p.quantity}`)
        .join(', ')
      const agreed = checkStatedStatusAgainstLines(body.fulfilment_status, projectedStatus, detail)
      if (!agreed.ok) {
        return NextResponse.json(
          { error: 'status_disagrees_with_lines', message: agreed.why, from: order.fulfilment_status },
          { status: 422 },
        )
      }
    }

    // ─── Can the shelf actually cover this? Asked BEFORE anything is claimed ─
    //
    // THE DEFECT THIS CLOSES, measured on the running server (2026-08-26):
    // shipping 5 units of a SKU with 2 on hand claimed the line FIRST, then hit
    // `CHECK (on_hand >= 0)` on the stock write, and this handler returned the
    // driver's own string — `500 {"error":"CHECK constraint failed: on_hand >=
    // 0"}` — from a path that never reverted the claim. The line was left
    // reading 5 of 5 fulfilled with the stock untouched and no audit row: five
    // units recorded as shipped that nothing had shipped. Overselling is an
    // ordinary thing for an operator to try, so it now gets an ordinary refusal
    // with real numbers, like every other refusal in this file.
    //
    // This check is deliberately NOT the safety net — stock can be taken by
    // another writer between here and the claim below. The net is the identical
    // check inside the loop, which reverts. This one exists so the ordinary
    // case refuses with NOTHING written, and refuses about every short SKU at
    // once instead of one line at a time.
    //
    // Two plan entries can name the same SKU (an order may carry it on two
    // lines), so what is needed is summed per SKU, not per line.
    const wantedPerSku = new Map<string, number>()
    for (const step of plan.value) {
      wantedPerSku.set(step.line.sku, (wantedPerSku.get(step.line.sku) ?? 0) + step.quantity)
    }
    const shortfalls: string[] = []
    for (const [sku, quantity] of wantedPerSku) {
      const { data: levelRows, error: levelError } = await db()
        .from('inventory_levels')
        .select('id,on_hand,location')
        .eq('project', project)
        .eq('sku', sku)
      if (levelError) return dbQueryErrorResponse(levelError, 'inventory_levels')
      const levels = sortLevels(levelRows)
      // NO stock record at all is not a shortfall: it is a gap in the
      // catalogue, and the units still shipped. The loop below says so in
      // `stock_note` rather than refusing — unchanged behaviour, on purpose.
      if (levels.length === 0) continue
      if (!pickLevelFor(levels, quantity)) shortfalls.push(describeShortfall(project, sku, quantity, levels))
    }
    if (shortfalls.length > 0) {
      return NextResponse.json(
        {
          error: 'insufficient_stock',
          message: `${orderNumber} was NOT shipped: ${shortfalls.join(' ')}`,
          project,
          order_number: orderNumber,
          from: order.fulfilment_status,
          lines: [],
          stock_moves: [],
        },
        { status: 422 },
      )
    }

    // ─── Run the plan, one line at a time ───────────────────────────────────
    //
    // Per line: CLAIM the units (CAS on fulfilled_quantity) -> MOVE the stock
    // (CAS on on_hand) -> AUDIT. Every failure after a write reverts what it
    // wrote, and says plainly when a revert itself lost its race — there is no
    // cross-table transaction on either dialect and pretending otherwise is
    // what a silent divergence is made of.
    const shipped: {
      line_id: string
      sku: string
      quantity: number
      fulfilled_quantity: number
      remaining: number
      on_hand: number | null
      location: string | null
    }[] = []

    for (const step of plan.value) {
      let claimedFrom: number | null = null
      let claimedTo: number | null = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && claimedFrom === null; attempt++) {
        const { data: fresh, error: freshError } = await db()
          .from('order_line_items')
          .select('id,sku,quantity,fulfilled_quantity')
          .eq('id', step.line.id)
          .maybeSingle<OrderLineState>()
        if (freshError) return dbQueryErrorResponse(freshError, 'order_line_items')
        if (!fresh) {
          return NextResponse.json(
            {
              error: 'conflict',
              message:
                `line ${step.line.id} (sku "${step.line.sku}") on ${orderNumber} no longer exists — it was ` +
                `removed between reading this order and shipping it. Lines shipped this call: ` +
                `${JSON.stringify(shipped)}. Re-read the order.`,
            },
            { status: 409 },
          )
        }

        // RE-CHECK against the value just read, not against the plan. Another
        // shipment may have taken the units this request wanted in the window
        // between the plan and this attempt; applying the plan's number on top
        // of a value known to be stale is the lost-update bug in a new place.
        const remaining = lineRemaining(fresh)
        if (step.quantity > remaining) {
          return NextResponse.json(
            {
              error: 'conflict',
              message:
                `line "${fresh.sku}" (${fresh.id}) now has ${fresh.fulfilled_quantity} of ${fresh.quantity} ` +
                `fulfilled, so only ${remaining} remain — a concurrent shipment took the units this request ` +
                `asked for (${step.quantity}). Lines shipped this call: ${JSON.stringify(shipped)}. ` +
                `Re-read the order and ship at most ${remaining} on this line.`,
            },
            { status: 409 },
          )
        }

        const next = fresh.fulfilled_quantity + step.quantity
        const { data: written, error: claimError } = await db()
          .from('order_line_items')
          .update({ fulfilled_quantity: next })
          .eq('id', fresh.id)
          .eq('fulfilled_quantity', fresh.fulfilled_quantity)
          .select('*')
        if (claimError) return dbQueryErrorResponse(claimError, 'order_line_items')

        if (((written ?? []) as unknown[]).length > 0) {
          claimedFrom = fresh.fulfilled_quantity
          claimedTo = next
          break
        }
        // Lost the race for this line: re-read and try again.
      }

      if (claimedFrom === null || claimedTo === null) {
        return NextResponse.json(
          {
            error: 'conflict',
            message:
              `line "${step.line.sku}" (${step.line.id}) on ${orderNumber} did not accept its claim after ` +
              `${MAX_ATTEMPTS} attempts — too many concurrent shipments against that line. Lines shipped this ` +
              `call: ${JSON.stringify(shipped)}. Nothing was changed for this line; retry it.`,
          },
          { status: 409 },
        )
      }

      // ── The units are claimed. Now move the stock they represent. ─────────
      //
      // EVERY exit from this loop after the claim above compensates for it. The
      // two that did not — a failed level read and a failed level write — are
      // what left an order recorded as part-shipped with its stock untouched;
      // see `claimRevertNote` for the measurement.
      let onHandAfter: number | null = null
      let shippedFrom: string | null = null
      let stockMoved = false
      let levelMissing = false

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !stockMoved && !levelMissing; attempt++) {
        const { data: levelRows, error: levelError } = await db()
          .from('inventory_levels')
          .select('id,on_hand,location')
          .eq('project', project)
          .eq('sku', step.line.sku)
        if (levelError) {
          const claimBack = await revertLineClaim(step.line.id, claimedTo, claimedFrom)
          return NextResponse.json(
            {
              error: claimBack ? 'stock_read_failed' : 'stock_read_failed_unreconciled',
              message:
                `line "${step.line.sku}" on ${orderNumber} was NOT shipped: its stock level could not be read ` +
                `(${levelError.message}). ${claimRevertNote(claimedFrom, claimedTo, claimBack)} Lines shipped ` +
                `earlier in this call (and NOT reverted): ${JSON.stringify(shipped)}.`,
              project,
              order_number: orderNumber,
              lines: shipped,
            },
            { status: 500 },
          )
        }

        const levels = sortLevels(levelRows)
        if (levels.length === 0) {
          // Say it rather than silently skipping: a line with no stock record
          // is a real gap in the catalogue, not a no-op. The units still count
          // as shipped — the parcel left whether or not this database was
          // tracking stock for that SKU.
          levelMissing = true
          break
        }

        const level = pickLevelFor(levels, step.quantity)
        if (!level) {
          // The pre-flight check above already refused the ordinary oversell
          // with nothing written. Reaching here means the stock was taken
          // between that check and this claim, so the claim is given back and
          // the same sentence is used — an operator should not have to learn
          // two vocabularies for one fact.
          const claimBack = await revertLineClaim(step.line.id, claimedTo, claimedFrom)
          return NextResponse.json(
            {
              error: claimBack ? 'insufficient_stock' : 'insufficient_stock_unreconciled',
              message:
                `${orderNumber}: ${describeShortfall(project, step.line.sku, step.quantity, levels)} ` +
                `${claimRevertNote(claimedFrom, claimedTo, claimBack)} Lines shipped earlier in this call ` +
                `(and NOT reverted): ${JSON.stringify(shipped)}.`,
              project,
              order_number: orderNumber,
              lines: shipped,
            },
            { status: claimBack ? 422 : 500 },
          )
        }

        const nextOnHand = level.on_hand - step.quantity
        const writeNow = new Date().toISOString()
        const { data: written, error: stockError } = await db()
          .from('inventory_levels')
          .update({ on_hand: nextOnHand, updated_at: writeNow })
          .eq('id', level.id)
          .eq('on_hand', level.on_hand)
          .select('*')
        if (stockError) {
          const claimBack = await revertLineClaim(step.line.id, claimedTo, claimedFrom)
          return NextResponse.json(
            {
              error: claimBack ? 'stock_write_failed' : 'stock_write_failed_unreconciled',
              message:
                `line "${step.line.sku}" on ${orderNumber} was NOT shipped: its stock could not be moved at ` +
                `location "${level.location}" (${stockError.message}). ` +
                `${claimRevertNote(claimedFrom, claimedTo, claimBack)} Lines shipped earlier in this call ` +
                `(and NOT reverted): ${JSON.stringify(shipped)}.`,
              project,
              order_number: orderNumber,
              lines: shipped,
            },
            { status: 500 },
          )
        }
        if (((written ?? []) as unknown[]).length === 0) continue

        const { error: auditError } = await db().from('commerce_actions').insert({
          project,
          action: 'inventory.adjust',
          object_type: 'inventory',
          object_ref: step.line.sku,
          from_value: String(level.on_hand),
          to_value: String(nextOnHand),
          reason:
            `fulfilled ${step.quantity} of order ${orderNumber} line ${step.line.id} ` +
            `from location "${level.location}"`,
          actor,
          created_at: writeNow,
        })
        if (auditError) {
          const stockBack = await revertStock(level.id, nextOnHand, level.on_hand)
          const claimBack = await revertLineClaim(step.line.id, claimedTo, claimedFrom)
          return NextResponse.json(
            {
              error: stockBack && claimBack ? 'audit_write_failed' : 'audit_write_failed_unreconciled',
              message:
                `line "${step.line.sku}" on ${orderNumber} was NOT shipped: its stock audit row could not be ` +
                `written (${auditError.message}). Stock revert ${stockBack ? 'landed' : 'LOST ITS OWN RACE'}; ` +
                `line-claim revert (${claimedTo} -> ${claimedFrom}) ${claimBack ? 'landed' : 'LOST ITS OWN RACE'}. ` +
                `${stockBack && claimBack
                  ? 'The net effect for this line is that nothing changed; retry.'
                  : 'This line has diverged from its audit trail and needs manual reconciliation — this db seam ' +
                    'has no cross-table transaction on either dialect.'} Lines shipped earlier in this call ` +
                `(and NOT reverted): ${JSON.stringify(shipped)}.`,
            },
            { status: 500 },
          )
        }

        onHandAfter = nextOnHand
        shippedFrom = level.location
        stockMoved = true
      }

      if (!stockMoved && !levelMissing) {
        // The claim is taken but its stock never moved. Give the units back
        // rather than leaving the order claiming a shipment the shelf denies.
        const claimBack = await revertLineClaim(step.line.id, claimedTo, claimedFrom)
        return NextResponse.json(
          {
            error: 'conflict',
            message:
              `stock for "${step.line.sku}" did not move after ${MAX_ATTEMPTS} attempts — too many concurrent ` +
              `writers to that SKU. ${claimRevertNote(claimedFrom, claimedTo, claimBack)} ` +
              `Lines shipped earlier in this call: ${JSON.stringify(shipped)}. Retry.`,
          },
          { status: claimBack ? 409 : 500 },
        )
      }

      shipped.push({
        line_id: step.line.id,
        sku: step.line.sku,
        quantity: step.quantity,
        fulfilled_quantity: claimedTo,
        remaining: step.line.quantity - claimedTo,
        on_hand: onHandAfter,
        // WHICH SHELF the parcel came off. `null` only when the SKU has no
        // stock record at all, which `stock_note` also reports.
        location: shippedFrom,
      })
    }

    // ─── Reconcile the order's status to what its lines now say ─────────────
    //
    // Last, and from a FRESH read of both the lines and the order: a concurrent
    // shipment may have moved either since this request started. This loop's
    // only job is to make `orders.fulfilment_status` equal
    // `deriveFulfilmentStatus(lines)`, and it is a compare-and-swap for the same
    // reason every other write in this file is one.
    let finalStatus: FulfilmentStatus = projectedStatus
    let statusFrom: string = order.fulfilment_status
    let statusNote: string | null = null
    let settled = false

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !settled; attempt++) {
      const { rows: freshLines, error: freshLinesError } = await readLineStates(order.id)
      if (freshLinesError) return dbQueryErrorResponse(freshLinesError, 'order_line_items')

      const { data: freshOrder, error: freshOrderError } = await db()
        .from('orders')
        .select('*')
        .eq('project', project)
        .eq('order_number', orderNumber)
        .maybeSingle<OrderRow>()
      if (freshOrderError) return dbQueryErrorResponse(freshOrderError, 'orders')
      if (!freshOrder) {
        statusNote = `${orderNumber} disappeared while its lines were being shipped; its status was not updated.`
        break
      }

      const target = deriveFulfilmentStatus(freshLines)
      statusFrom = freshOrder.fulfilment_status
      finalStatus = target

      if (freshOrder.fulfilment_status === 'cancelled') {
        // Somebody cancelled the order mid-shipment. The units really did go,
        // and the stock really did move — overwriting `cancelled` would hide a
        // decision an operator made. Reported instead.
        statusNote =
          `${orderNumber} was CANCELLED by a concurrent request while these units were shipping. The stock ` +
          `movements above are real and are audited, and the order's status was left at cancelled rather than ` +
          `overwritten. Its lines now read ` +
          `${freshLines.map(l => `${l.sku}: ${l.fulfilled_quantity}/${l.quantity}`).join(', ')} — reconcile by hand.`
        finalStatus = 'cancelled'
        settled = true
        break
      }

      if (target === freshOrder.fulfilment_status) {
        // Already correct — either nothing needed changing (a partial shipment
        // onto an already-partial order) or a concurrent writer got there
        // first with the same answer. Either way there is nothing to write,
        // and writing anyway would produce an audit row for a change that did
        // not happen.
        settled = true
        break
      }

      const now = new Date().toISOString()
      const { data: moved, error: statusError } = await db()
        .from('orders')
        .update({ fulfilment_status: target, updated_at: now })
        .eq('project', project)
        .eq('order_number', orderNumber)
        .eq('fulfilment_status', freshOrder.fulfilment_status)
        .select('*')
      if (statusError) return dbQueryErrorResponse(statusError, 'orders')
      if (((moved ?? []) as unknown[]).length === 0) continue

      const { error: auditError } = await db().from('commerce_actions').insert({
        project,
        action: 'order.fulfilment',
        object_type: 'order',
        object_ref: orderNumber,
        from_value: freshOrder.fulfilment_status,
        to_value: target,
        reason: `shipped ${shipped.reduce((n, s) => n + s.quantity, 0)} unit(s) across ${shipped.length} line(s)`,
        actor,
        created_at: now,
      })
      if (auditError) {
        // The stock moved and IS audited, per line, above. What failed is the
        // record of the order's own status change. Put the status back and say
        // exactly what state the order is in, rather than leaving an unaudited
        // status change standing.
        const { data: reverted, error: revertError } = await db()
          .from('orders')
          .update({ fulfilment_status: freshOrder.fulfilment_status, updated_at: new Date().toISOString() })
          .eq('project', project)
          .eq('order_number', orderNumber)
          .eq('fulfilment_status', target)
          .select('*')
        const revertLanded = !revertError && ((reverted ?? []) as unknown[]).length > 0
        return NextResponse.json(
          {
            error: revertLanded ? 'audit_write_failed' : 'audit_write_failed_unreconciled',
            message:
              `the units below DID ship and their stock movements are recorded, but ${orderNumber}'s own ` +
              `status-change audit row could not be written (${auditError.message}). The status change ` +
              `(${freshOrder.fulfilment_status} -> ${target}) ` +
              `${revertLanded
                ? `was reverted, so the order still reads ${freshOrder.fulfilment_status} while its lines read ` +
                  `shipped. Once the audit table accepts writes, settle it with ` +
                  `PATCH {"order_number":"${orderNumber}","fulfilment_status":"${target}"} and no ` +
                  `line_fulfilments — that request moves no units and only brings the status into line with ` +
                  `the quantities already recorded.`
                : `could NOT be reverted — the compensating write lost its own race. The order's status and its ` +
                  `audit trail have diverged and need manual reconciliation.`}`,
            project,
            order_number: orderNumber,
            lines: shipped,
          },
          { status: 500 },
        )
      }

      settled = true
    }

    if (!settled && statusNote === null) {
      statusNote =
        `the units below shipped and are recorded on their lines, but ${orderNumber}'s own fulfilment_status ` +
        `could not be settled after ${MAX_ATTEMPTS} attempts — concurrent writers kept moving it. The lines ` +
        `are the source of truth; re-read the order, and settle its status with ` +
        `PATCH {"order_number":"${orderNumber}","fulfilment_status":"${finalStatus}"} and no line_fulfilments ` +
        `— that request moves no units and only brings the status into line with the lines.`
    }

    return NextResponse.json({
      project,
      order_number: orderNumber,
      from: order.fulfilment_status,
      fulfilment_status: finalStatus,
      status_settled_from: statusFrom,
      status_note: statusNote,
      lines: shipped,
      // The pre-074 field name, kept so an existing caller reading
      // `stock_moves` still sees the movements. Its shape is the same
      // {sku, quantity, on_hand} triple it always was.
      stock_moves: shipped.map(s => ({ sku: s.sku, quantity: s.quantity, on_hand: s.on_hand })),
      stock_note: shipped.some(s => s.on_hand === null)
        ? `no stock record exists in ${project} for ` +
          `${shipped.filter(s => s.on_hand === null).map(s => `"${s.sku}"`).join(', ')} — those units are ` +
          `recorded as shipped on their lines, but no level could be decremented for them.`
        : null,
    })
  },
)
