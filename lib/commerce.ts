// lib/commerce.ts — commerce-operations piece (Wave 7)
//
// The pure half of the commerce surface. No database handle, no React, no
// network: every function here takes plain data and returns plain data, which
// is what makes lib/__tests__/commerce.test.ts able to PROVE the refusals
// rather than assert them in a comment.
//
// Three things live here and nowhere else:
//
//   1. MONEY. Amounts are stored as an integer count of the minor unit of
//      their own currency (see migrations/064_commerce.sql for the full
//      argument). That decision is only safe if exactly one place converts
//      between a typed amount and minor units — otherwise the second place
//      reaches for parseFloat and the whole point is lost. This is that place,
//      and it contains no parseFloat, no Number() applied to an amount, and no
//      `* 100`. It does integer arithmetic on digit substrings.
//
//   2. THE FULFILMENT STATE MACHINE. Which moves an operator may make on an
//      order. A CHECK constraint cannot express this — it sees one row, not the
//      change — so it lives here and every write applies it.
//
//   3. THE VALIDATORS. Every commerce WRITE goes through one of these before
//      anything is stored, in the stance app/api/hub-settings/route.ts sets: an
//      unknown key is REFUSED, not stored. An endpoint that silently ignores a
//      field the caller sent is an endpoint the caller believes did something
//      it did not.

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * Minor-unit exponent per currency: how many decimal places the currency has.
 *
 * This is an explicit table rather than a default of 2 because the exponent is
 * not universal — JPY has none, and a wrong exponent is not a small error, it
 * is a factor of 100. Guessing 2 for JPY turns ¥1500 into ¥15.00 silently.
 *
 * An unrecognised code is REFUSED (see `currencyExponent`), which is the
 * fail-closed answer: better a caller who must add a line here than an amount
 * that is wrong by two orders of magnitude and looks fine.
 */
export const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  MXN: 2,
  AUD: 2,
  JPY: 0,
}

/** Supported currency codes, for error messages and for the API's validators. */
export const SUPPORTED_CURRENCIES: readonly string[] = Object.keys(CURRENCY_EXPONENT).sort()

/** A validated success, or a refusal that says why in words a human reads. */
export type Verdict<T> = { ok: true; value: T } | { ok: false; why: string }

const ok = <T>(value: T): Verdict<T> => ({ ok: true, value })
const no = <T>(why: string): Verdict<T> => ({ ok: false, why })

/**
 * Decimal places for a currency, or a refusal naming what is supported.
 * Never falls back to 2 — see CURRENCY_EXPONENT.
 */
export function currencyExponent(currency: string): Verdict<number> {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
    return no(`currency must be a three-letter code, got ${JSON.stringify(currency)}`)
  }
  const code = currency.toUpperCase()
  const exponent = CURRENCY_EXPONENT[code]
  if (exponent === undefined) {
    return no(
      `unsupported currency "${code}" — its minor-unit precision is unknown, ` +
        `and assuming two decimal places would silently multiply every amount ` +
        `in it by 100. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
    )
  }
  return ok(exponent)
}

/** Normalise a currency code, or refuse it. Uppercases; never invents. */
export function normaliseCurrency(currency: string): Verdict<string> {
  const exponent = currencyExponent(currency)
  if (!exponent.ok) return no(exponent.why)
  return ok(currency.toUpperCase())
}

/**
 * Parse a human-typed amount into an exact integer number of minor units.
 *
 * `parseAmountToMinor('19.99', 'USD') -> 1999`
 * `parseAmountToMinor('0.10',  'USD') -> 10`
 * `parseAmountToMinor('1500',  'JPY') -> 1500`   (JPY has no minor unit)
 *
 * HOW, and why it matters: the string is split on its single decimal point and
 * the two halves are handled as DIGIT STRINGS — the fraction is right-padded
 * with zeros to the currency's exponent and the two are concatenated, then
 * converted once with BigInt. `parseFloat('19.99') * 100` is 1998.9999999999998
 * and `Math.round` hides that for small values and stops hiding it for large
 * ones. No float is ever constructed here.
 *
 * REFUSES: an empty or blank string, exponent notation (`1e2`), more than one
 * decimal point, more decimal places than the currency has, any character that
 * is not a digit / point / leading sign, `NaN`, `Infinity`, and a number-typed
 * input that is not a safe integer (a JS number that already went through a
 * float is not a trustworthy amount — pass the string, or pass minor units).
 */
export function parseAmountToMinor(
  raw: string | number,
  currency: string,
  options: { allowNegative?: boolean } = {},
): Verdict<number> {
  const exp = currencyExponent(currency)
  if (!exp.ok) return no(exp.why)
  const exponent = exp.value
  const code = currency.toUpperCase()

  // A number-typed input is accepted ONLY when it is already an exact integer
  // count of minor units. Anything with a fractional part arrived through a
  // float and its exactness cannot be recovered — refuse rather than guess.
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) {
      return no(
        `amount ${String(raw)} is not an exact integer. Pass money as a string ` +
          `("19.99") or as a whole number of minor units — a fractional JS ` +
          `number has already lost precision.`,
      )
    }
    if (raw < 0 && !options.allowNegative) return no('amount must not be negative')
    return ok(raw)
  }

  if (typeof raw !== 'string') return no('amount must be a string or a whole number')

  const text = raw.trim()
  if (text === '') return no('amount is required')

  const signed = /^[+-]/.test(text)
  const sign = text.startsWith('-') ? -1 : 1
  const body = signed ? text.slice(1) : text

  if (sign < 0 && !options.allowNegative) return no('amount must not be negative')

  // One optional decimal point, digits either side. This rejects `1e2`,
  // `12.34.5`, `1,299.00`, `$19.99`, `NaN`, `Infinity` and `.` in one test.
  const shape = /^(\d+)(?:\.(\d*))?$/.exec(body)
  if (!shape) {
    return no(
      `"${raw}" is not a plain decimal amount. Write digits with at most one ` +
        `decimal point (for example "19.99") — no exponent notation, no ` +
        `thousands separators, no currency symbol.`,
    )
  }

  const whole = shape[1]
  const fraction = shape[2] ?? ''

  if (fraction.length > exponent) {
    return no(
      exponent === 0
        ? `${code} has no minor unit, so "${raw}" cannot be represented — it must be a whole number`
        : `${code} has ${exponent} decimal places, so "${raw}" cannot be represented exactly`,
    )
  }

  // Right-pad the fraction to the currency's precision and concatenate. Pure
  // string work; the single conversion below is the only numeric step.
  const digits = whole + fraction.padEnd(exponent, '0')
  const minor = BigInt(digits) * BigInt(sign)

  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(-Number.MAX_SAFE_INTEGER)) {
    return no(`amount "${raw}" is larger than this system stores exactly`)
  }

  return ok(Number(minor))
}

/**
 * Render minor units back as a decimal string. The exact inverse of
 * `parseAmountToMinor` — `parse(format(n, c), c) === n` for every n.
 *
 * Again with no float: the integer's digit string is split at the exponent.
 */
export function formatMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency)
  // Formatting is called from render paths where throwing would blank a card.
  // An unknown currency is shown as-is with its raw integer rather than being
  // silently divided by an assumed 100.
  if (!exp.ok) return `${minor} ${String(currency).toUpperCase()}`
  const exponent = exp.value
  const negative = minor < 0
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0')
  const whole = digits.slice(0, digits.length - exponent)
  const fraction = exponent === 0 ? '' : '.' + digits.slice(digits.length - exponent)
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** `1999, 'USD'` -> `'19.99 USD'`. Display only; never parsed back. */
export function describeMoney(minor: number, currency: string): string {
  return `${formatMinor(minor, currency)} ${String(currency).toUpperCase()}`
}

// ─── The fulfilment state machine ───────────────────────────────────────────

export const FULFILMENT_STATES = [
  'unfulfilled',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
] as const

export type FulfilmentStatus = (typeof FULFILMENT_STATES)[number]

/**
 * Which moves an operator may make, as data.
 *
 *   unfulfilled          -> partially_fulfilled | fulfilled | cancelled
 *   partially_fulfilled  -> fulfilled | cancelled
 *   fulfilled            -> (nothing)
 *   cancelled            -> (nothing)
 *
 * Two rules this encodes deliberately:
 *   * There is no un-shipping. `fulfilled` is terminal because the parcel has
 *     left; a mistake after that is a RETURN, which is a different object with
 *     its own money movement, not a reversal of this field.
 *   * `cancelled` is terminal for the same reason in the other direction.
 * A transition to the state the order is already in is NOT in this table, so
 * it is refused — a green answer for an action that changed nothing is the
 * silent-success shape this repo already ruled against on the approvals path.
 */
const FULFILMENT_TRANSITIONS: Readonly<Record<FulfilmentStatus, readonly FulfilmentStatus[]>> = {
  unfulfilled: ['partially_fulfilled', 'fulfilled', 'cancelled'],
  partially_fulfilled: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
}

export function isFulfilmentStatus(value: unknown): value is FulfilmentStatus {
  return typeof value === 'string' && (FULFILMENT_STATES as readonly string[]).includes(value)
}

/** True when moving `from` -> `to` is a move the state machine allows. */
export function canFulfilmentTransition(from: unknown, to: unknown): boolean {
  if (!isFulfilmentStatus(from) || !isFulfilmentStatus(to)) return false
  return FULFILMENT_TRANSITIONS[from].includes(to)
}

/** The move, or a refusal naming both states and what is reachable. */
export function checkFulfilmentTransition(from: unknown, to: unknown): Verdict<FulfilmentStatus> {
  if (!isFulfilmentStatus(to)) {
    return no(
      `"${String(to)}" is not a fulfilment state. Known states: ${FULFILMENT_STATES.join(', ')}`,
    )
  }
  if (!isFulfilmentStatus(from)) {
    return no(`the order's current fulfilment state "${String(from)}" is not a known state`)
  }
  if (from === to) {
    return no(`this order is already ${to} — that move would change nothing`)
  }
  if (!canFulfilmentTransition(from, to)) {
    const reachable = FULFILMENT_TRANSITIONS[from]
    return no(
      reachable.length === 0
        ? `${from} is final — an order that is ${from} cannot move to ${to}`
        : `an order that is ${from} cannot move to ${to}; it can only move to ${reachable.join(' or ')}`,
    )
  }
  return ok(to)
}

// ─── Product validation ─────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]

/** Fields `POST /api/commerce/products` accepts. Anything else is refused. */
export const PRODUCT_CREATE_FIELDS = [
  'sku',
  'title',
  'price',
  'price_minor',
  'currency',
  'status',
  'reorder_point',
  'project',
] as const

/** Fields `PATCH /api/commerce/products` accepts. */
export const PRODUCT_UPDATE_FIELDS = [
  'sku',
  'price',
  'price_minor',
  'currency',
  'status',
  'project',
] as const

/**
 * Refuse a body carrying a field the endpoint does not implement.
 *
 * This is the hub-settings stance, generalised: an unknown key is a typo or an
 * injection, never a feature. Without this, `{"price_usd": "19.99"}` is stored
 * as a product with price 0 and the caller has no way to know their field went
 * nowhere.
 */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): Verdict<true> {
  const unknown = Object.keys(body).filter(k => !allowed.includes(k))
  if (unknown.length > 0) {
    return no(
      `unknown field${unknown.length > 1 ? 's' : ''} ${unknown.map(f => `"${f}"`).join(', ')}. ` +
        `Accepted: ${allowed.join(', ')}`,
    )
  }
  return ok(true)
}

/**
 * A SKU as the storefront will hold it.
 * Refuses blank, whitespace-bearing and over-long codes — a SKU is typed into
 * a scanner and a URL, so a space in one is a defect that surfaces much later.
 */
export function validateSku(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string') return no('sku is required')
  const sku = raw.trim()
  if (sku === '') return no('sku is required')
  if (sku.length > 64) return no(`sku is ${sku.length} characters; the limit is 64`)
  if (/\s/.test(sku)) return no(`sku "${sku}" contains whitespace; use - or _ instead`)
  return ok(sku)
}

export function validateProductStatus(raw: unknown): Verdict<ProductStatus> {
  if (raw === undefined || raw === null) return ok('draft')
  if (typeof raw !== 'string' || !(PRODUCT_STATUSES as readonly string[]).includes(raw)) {
    return no(`status must be one of ${PRODUCT_STATUSES.join(', ')}, got ${JSON.stringify(raw)}`)
  }
  return ok(raw as ProductStatus)
}

/** A whole-number count with a floor of 0 (stock, reorder points). */
export function validateWholeCount(raw: unknown, field: string): Verdict<number> {
  if (raw === undefined || raw === null) return ok(0)
  const value = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return no(`${field} must be a whole number of units, 0 or more, got ${JSON.stringify(raw)}`)
  }
  return ok(value)
}

export interface NewProduct {
  sku: string
  title: string
  status: ProductStatus
  price_minor: number
  currency: string
  reorder_point: number
}

/**
 * Everything `POST /api/commerce/products` needs, validated together — because
 * the price cannot be checked without knowing the currency, and neither can be
 * checked before the body is known to carry no field the route ignores.
 */
export function validateNewProduct(body: Record<string, unknown>): Verdict<NewProduct> {
  const fields = rejectUnknownFields(body, PRODUCT_CREATE_FIELDS)
  if (!fields.ok) return no(fields.why)

  const sku = validateSku(body.sku)
  if (!sku.ok) return no(sku.why)

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    return no('title is required — a product with no name cannot be sold or found')
  }

  // `currency` defaults to USD only when OMITTED. A present-but-wrong-type
  // value (a number like ISO 4217's numeric 392 for JPY, `null`, an object)
  // used to fall into the same `typeof !== 'string'` branch as "omitted" and
  // silently become USD — the one currency defect in this file that failed
  // silently instead of refusing loudly. A caller sending numeric 392 got a
  // product priced in USD with no error anywhere.
  if (body.currency !== undefined && typeof body.currency !== 'string') {
    return no(`currency must be a string, got ${JSON.stringify(body.currency)} (${typeof body.currency})`)
  }
  const currency = normaliseCurrency(body.currency ?? 'USD')
  if (!currency.ok) return no(currency.why)

  if (body.price === undefined && body.price_minor === undefined) {
    return no('price is required — pass price ("19.99") or price_minor (1999)')
  }
  if (body.price !== undefined && body.price_minor !== undefined) {
    return no('pass either price or price_minor, not both — they would disagree')
  }
  const rawPrice = (body.price ?? body.price_minor) as string | number
  if (typeof rawPrice !== 'string' && typeof rawPrice !== 'number') {
    return no('price must be a decimal string ("19.99") or a whole number of minor units')
  }
  // `price_minor` is minor units already; `price` is a typed amount.
  const price =
    body.price_minor !== undefined
      ? validateWholeCount(rawPrice, 'price_minor')
      : parseAmountToMinor(rawPrice, currency.value)
  if (!price.ok) return no(price.why)

  const status = validateProductStatus(body.status)
  if (!status.ok) return no(status.why)

  const reorder = validateWholeCount(body.reorder_point, 'reorder_point')
  if (!reorder.ok) return no(reorder.why)

  return ok({
    sku: sku.value,
    title: body.title.trim(),
    status: status.value,
    price_minor: price.value,
    currency: currency.value,
    reorder_point: reorder.value,
  })
}

// ─── Inventory adjustment ───────────────────────────────────────────────────

/** Fields `PATCH /api/commerce/inventory` accepts. */
export const INVENTORY_ADJUST_FIELDS = ['sku', 'location', 'delta', 'reason', 'project'] as const

export interface InventoryAdjustment {
  sku: string
  location: string
  delta: number
  reason: string
}

/**
 * A stock adjustment an operator is about to make.
 *
 * `reason` is REQUIRED and not defaulted. Stock that changed for no recorded
 * reason is indistinguishable from stock that was miscounted, and the whole
 * point of `commerce_actions` is that six months later somebody can ask why.
 */
export function validateAdjustment(body: Record<string, unknown>): Verdict<InventoryAdjustment> {
  const fields = rejectUnknownFields(body, INVENTORY_ADJUST_FIELDS)
  if (!fields.ok) return no(fields.why)

  const sku = validateSku(body.sku)
  if (!sku.ok) return no(sku.why)

  const rawLocation = body.location === undefined || body.location === null ? 'default' : body.location
  if (typeof rawLocation !== 'string' || rawLocation.trim() === '') {
    return no('location must be a non-empty name; omit it for the default location')
  }

  const rawDelta = body.delta
  const delta =
    typeof rawDelta === 'string' && /^[+-]?\d+$/.test(rawDelta.trim())
      ? Number(rawDelta.trim())
      : rawDelta
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta)) {
    return no(
      `delta must be a whole number of units, positive or negative, got ${JSON.stringify(rawDelta)}`,
    )
  }
  if (delta === 0) {
    return no('delta 0 would change nothing — say how many units moved, or do not adjust')
  }

  if (typeof body.reason !== 'string' || body.reason.trim() === '') {
    return no(
      'reason is required — stock that changed with no recorded reason cannot be audited later',
    )
  }
  if (body.reason.trim().length > 280) {
    return no('reason is longer than 280 characters; summarise it')
  }

  return ok({
    sku: sku.value,
    location: rawLocation.trim(),
    delta,
    reason: body.reason.trim(),
  })
}

/**
 * Apply a delta to a stock level, or refuse.
 *
 * Refuses a result below zero, naming the current level and the delta, because
 * negative stock is not a state a storefront can be in — it means either the
 * count or the sale is wrong, and both need a human.
 */
export function applyAdjustment(onHand: number, delta: number): Verdict<number> {
  if (!Number.isSafeInteger(onHand) || onHand < 0) {
    return no(`current stock ${JSON.stringify(onHand)} is not a whole number of units`)
  }
  if (!Number.isSafeInteger(delta)) {
    return no(`delta ${JSON.stringify(delta)} is not a whole number of units`)
  }
  const next = onHand + delta
  if (next < 0) {
    return no(
      `that would take stock to ${next}. On hand is ${onHand} and the adjustment is ` +
        `${delta > 0 ? '+' : ''}${delta}; stock cannot go below zero.`,
    )
  }
  return ok(next)
}

// ─── Scope ──────────────────────────────────────────────────────────────────
//
// TOD-2448: the resolver lives in lib/scope.ts. This copy and the one in
// lib/conversations.ts were near-identical, and the difference nobody chose was
// that THIS one had no project-name length cap while the other capped at 120.
// The failing-first test: a 121-character project name used to return
// { ok: true }; it now returns 400.
//
// `why` is kept as the field name so the existing suite stays green, and both
// wire conflict codes are preserved — merging scope_conflict and scope_mismatch
// is client-visible and is the owner's call.

import { COMMERCE_READ_SCOPE, COMMERCE_WRITE_SCOPE, resolveProjectScope, unscopedScopeMessage } from './scope'

export function unscopedCommerceMessage(what: string): string {
  return unscopedScopeMessage(what === 'commerce write' ? COMMERCE_WRITE_SCOPE : COMMERCE_READ_SCOPE)
}

export function resolveCommerceScope(
  resolved: string | null, requested: string | null, kind: 'read' | 'write' = 'read',
): { ok: true; project: string } | { ok: false; status: 400 | 409; error: string; why: string } {
  const v = resolveProjectScope(resolved, requested, kind === 'write' ? COMMERCE_WRITE_SCOPE : COMMERCE_READ_SCOPE)
  return v.ok ? v : { ok: false, status: v.status, error: v.error, why: v.message }
}

// ─── Order ingest ───────────────────────────────────────────────────────────

/**
 * Fields `POST /api/commerce/orders` accepts.
 *
 * An order is INGESTED, not authored: it originates with a customer at the
 * storefront, and this endpoint is what an importer or a webhook calls. It is
 * here for a specific reason — without it, `orders` could never hold a row from
 * anywhere in this repo, the Orders card would be permanently empty, and the
 * fulfilment action would be unreachable in the running app. An object nothing
 * can create is an object nobody can prove works.
 */
export const ORDER_CREATE_FIELDS = [
  'order_number',
  'placed_at',
  'customer_email',
  'currency',
  'total_minor',
  'total',
  'line_items',
  'fulfilment_status',
  'project',
] as const

/** Fields one line of an ingested order accepts. */
export const ORDER_LINE_FIELDS = [
  'sku',
  'title',
  'quantity',
  'unit_price',
  'unit_price_minor',
  // How many of this line had ALREADY shipped when the storefront handed the
  // order over. Optional, defaults to 0. It exists so that an order which is
  // genuinely part-shipped at ingest can say WHICH units went - see
  // `validateNewOrder`'s "the status is derived at the door too" note.
  'fulfilled_quantity',
] as const

export interface NewOrderLine {
  sku: string
  title: string
  quantity: number
  fulfilled_quantity: number
  unit_price_minor: number
  currency: string
}

export interface NewOrder {
  order_number: string
  placed_at: string
  customer_email: string | null
  currency: string
  total_minor: number
  fulfilment_status: FulfilmentStatus
  line_items: NewOrderLine[]
}

/**
 * Validate an ingested order and its lines together.
 *
 * The rule worth naming: the order total is COMPUTED from the lines, as exact
 * integer arithmetic (`quantity * unit_price_minor`, summed). A caller may pass
 * `total`/`total_minor`, and if it disagrees with the lines the order is
 * REFUSED rather than stored — an order whose total does not equal its lines is
 * a reconciliation failure, and storing it means discovering that months later
 * against a payout report instead of at the door.
 *
 * THE STATUS IS DERIVED AT THE DOOR TOO - the fix to a fabrication this piece
 * shipped. The piece doc claimed "the status is DERIVED from the lines, never
 * asserted", and that was true of PATCH and FALSE here. Measured on the running
 * server before this change (2026-08-26):
 *
 *   POST {order_number:'W8C-ING-1', fulfilment_status:'partially_fulfilled',
 *         line_items:[{sku:'W8C-OS', quantity:5, ...}]}
 *   -> 201, order stored `partially_fulfilled`, every line at 0 fulfilled,
 *      GET fulfilment {ordered:5, fulfilled:0, remaining:5}
 *
 * - the exact incoherent state PATCH refuses in so many words ("an order the
 * operator had been told was partly shipped, with every unit still on the shelf
 * and no record of which parcel left"), waved through by the other door. Ingest
 * now works the same way the total already does:
 *
 *   * a line may state `fulfilled_quantity` (0 <= it <= quantity);
 *   * `fulfilment_status: 'fulfilled'` with no per-line numbers still means
 *     "all of it", unchanged - that shorthand is what an importer of an
 *     already-shipped order sends, and it agrees with the lines by definition
 *     because the lines are written FROM it;
 *   * the status is otherwise DERIVED from those quantities, and a stated one
 *     that disagrees is REFUSED naming both;
 *   * `cancelled` is the single exemption, and deliberately: cancellation is a
 *     decision about an order, not a count of what left the warehouse, and
 *     `deriveFulfilmentStatus` cannot return it by construction. A cancelled
 *     order may carry any fulfilled quantities, including the partial shipment
 *     that went out before somebody cancelled the rest.
 */
export function validateNewOrder(body: Record<string, unknown>): Verdict<NewOrder> {
  const fields = rejectUnknownFields(body, ORDER_CREATE_FIELDS)
  if (!fields.ok) return no(fields.why)

  if (typeof body.order_number !== 'string' || body.order_number.trim() === '') {
    return no('order_number is required — it is what the customer and the operator both call it')
  }
  const orderNumber = body.order_number.trim()
  if (orderNumber.length > 64) return no(`order_number is ${orderNumber.length} characters; the limit is 64`)

  // Same rule as validateNewProduct: default to USD only when `currency` is
  // OMITTED. A present-but-wrong-type value (a number, `null`) used to be
  // treated identically to "omitted" and silently become USD.
  if (body.currency !== undefined && typeof body.currency !== 'string') {
    return no(`currency must be a string, got ${JSON.stringify(body.currency)} (${typeof body.currency})`)
  }
  const currency = normaliseCurrency(body.currency ?? 'USD')
  if (!currency.ok) return no(currency.why)

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return no('line_items is required — an order with no lines has nothing in it and no total')
  }

  const lines: NewOrderLine[] = []
  let computedTotal = 0
  /** Did ANY line say how much of it had already shipped? Decides whether
   *  `fulfilment_status: 'fulfilled'` is read as the all-of-it shorthand. */
  let statedAnyFulfilled = false
  for (const [index, raw] of body.line_items.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return no(`line ${index + 1} is not an object`)
    }
    const line = raw as Record<string, unknown>
    const known = rejectUnknownFields(line, ORDER_LINE_FIELDS)
    if (!known.ok) return no(`line ${index + 1}: ${known.why}`)

    const sku = validateSku(line.sku)
    if (!sku.ok) return no(`line ${index + 1}: ${sku.why}`)

    if (typeof line.title !== 'string' || line.title.trim() === '') {
      return no(`line ${index + 1}: title is required — a line records WHAT was sold`)
    }

    const quantity = validateWholeCount(line.quantity, 'quantity')
    if (!quantity.ok) return no(`line ${index + 1}: ${quantity.why}`)
    if (quantity.value < 1) return no(`line ${index + 1}: quantity must be at least 1`)

    // How many of this line arrived already shipped. The same bound the column's
    // CHECK carries (0 <= fulfilled <= quantity) is enforced here first, so the
    // refusal is a sentence with numbers in it rather than a driver string.
    let fulfilledQuantity = 0
    if (line.fulfilled_quantity !== undefined) {
      const already = validateWholeCount(line.fulfilled_quantity, 'fulfilled_quantity')
      if (!already.ok) return no(`line ${index + 1}: ${already.why}`)
      if (already.value > quantity.value) {
        return no(
          `line ${index + 1}: fulfilled_quantity is ${already.value} but only ${quantity.value} ` +
            `${quantity.value === 1 ? 'was' : 'were'} ordered - a line cannot have shipped more units than ` +
            `it sold. State at most ${quantity.value}, or raise quantity if the order really is bigger.`,
        )
      }
      statedAnyFulfilled = true
      fulfilledQuantity = already.value
    }

    if (line.unit_price !== undefined && line.unit_price_minor !== undefined) {
      return no(`line ${index + 1}: pass either unit_price or unit_price_minor, not both`)
    }
    if (line.unit_price === undefined && line.unit_price_minor === undefined) {
      return no(`line ${index + 1}: a unit price is required`)
    }
    const rawPrice = (line.unit_price ?? line.unit_price_minor) as string | number
    const price =
      line.unit_price_minor !== undefined
        ? validateWholeCount(rawPrice, 'unit_price_minor')
        : parseAmountToMinor(rawPrice, currency.value)
    if (!price.ok) return no(`line ${index + 1}: ${price.why}`)

    // Exact integer arithmetic — the reason money is stored this way at all.
    computedTotal += price.value * quantity.value
    lines.push({
      sku: sku.value,
      title: line.title.trim(),
      quantity: quantity.value,
      fulfilled_quantity: fulfilledQuantity,
      unit_price_minor: price.value,
      currency: currency.value,
    })
  }

  if (body.total !== undefined && body.total_minor !== undefined) {
    return no('pass either total or total_minor, not both — they would disagree')
  }
  if (body.total !== undefined || body.total_minor !== undefined) {
    const raw = (body.total ?? body.total_minor) as string | number
    const claimed =
      body.total_minor !== undefined
        ? validateWholeCount(raw, 'total_minor')
        : parseAmountToMinor(raw, currency.value)
    if (!claimed.ok) return no(claimed.why)
    if (claimed.value !== computedTotal) {
      return no(
        `the total given (${formatMinor(claimed.value, currency.value)} ${currency.value}) does not ` +
          `equal the lines (${formatMinor(computedTotal, currency.value)} ${currency.value}). ` +
          `An order whose total disagrees with its lines is a reconciliation failure, not a rounding one.`,
      )
    }
  }

  let placedAt = new Date().toISOString()
  if (body.placed_at !== undefined) {
    if (typeof body.placed_at !== 'string' || Number.isNaN(Date.parse(body.placed_at))) {
      return no(`placed_at must be an ISO-8601 timestamp, got ${JSON.stringify(body.placed_at)}`)
    }
    placedAt = new Date(body.placed_at).toISOString()
  }

  // An ingested order may arrive already fulfilled or already cancelled - the
  // state machine governs MOVES an operator makes, not the state a storefront
  // reports on the way in.
  let stated: FulfilmentStatus | null = null
  if (body.fulfilment_status !== undefined) {
    if (!isFulfilmentStatus(body.fulfilment_status)) {
      return no(
        `fulfilment_status must be one of ${FULFILMENT_STATES.join(', ')}, got ${JSON.stringify(body.fulfilment_status)}`,
      )
    }
    stated = body.fulfilment_status
  }

  // `fulfilment_status: 'fulfilled'` with no per-line numbers is the shorthand
  // for "all of it", and is the only place a status still WRITES quantities
  // instead of reading them. It cannot disagree with the lines, because the
  // lines are set from it.
  if (stated === 'fulfilled' && !statedAnyFulfilled) {
    for (const line of lines) line.fulfilled_quantity = line.quantity
  }

  const derived = deriveFulfilmentStatus(lines)
  if (stated !== null && stated !== 'cancelled' && stated !== derived) {
    return no(
      `this order is being ingested as ${stated}, but its own line quantities make it ${derived} ` +
        `(${lines.map(l => `${l.sku}: ${l.fulfilled_quantity}/${l.quantity} fulfilled`).join(', ')}). ` +
        `An order whose stated fulfilment disagrees with its lines is a reconciliation failure, not a ` +
        `rounding one - the same rule the total already follows. Say what shipped with ` +
        `line_items[].fulfilled_quantity, or omit fulfilment_status and it will be derived from them.`,
    )
  }
  // `cancelled` keeps what the caller stated; every other status IS the lines.
  const status: FulfilmentStatus = stated === 'cancelled' ? 'cancelled' : derived

  const email =
    body.customer_email === undefined || body.customer_email === null
      ? null
      : typeof body.customer_email === 'string' && body.customer_email.includes('@')
        ? body.customer_email.trim()
        : null
  if (body.customer_email !== undefined && body.customer_email !== null && email === null) {
    return no(`customer_email ${JSON.stringify(body.customer_email)} is not an email address`)
  }

  return ok({
    order_number: orderNumber,
    placed_at: placedAt,
    customer_email: email,
    currency: currency.value,
    total_minor: computedTotal,
    fulfilment_status: status,
    line_items: lines,
  })
}

// ─── Partial fulfilment ─────────────────────────────────────────────────────
//
// THE OBJECT THAT WAS MISSING
//   Until migration 074, `order_line_items` recorded how many units were
//   ORDERED and nothing about how many had SHIPPED. So `partially_fulfilled`
//   was a status an order could assert about itself with nothing underneath it:
//   the route's own comment said, correctly, that it could not move stock
//   because "order_line_items has no fulfilled-quantity column", and an
//   operator who marked an order partly shipped got HTTP 200, zero stock
//   movement, and no record anywhere of which parcel left.
//
//   That refusal was honest. It was also covering for a missing OBJECT rather
//   than a missing report, which is what 074 and this section fix.
//
// THE STANCE, WHICH IS THE ONE THIS FILE ALREADY TAKES ABOUT MONEY
//   `validateNewOrder` REFUSES an order whose stated total disagrees with the
//   sum of its lines, rather than storing the disagreement. Fulfilment gets the
//   same treatment: a fulfilment_status is DERIVED from the line quantities,
//   and a caller who also states one gets a refusal if the two disagree. The
//   status is a function of the lines, never a second, independent opinion
//   about the same fact — because a second opinion is exactly what
//   reconciliation failures are made of.
//
// EVERY REFUSAL HERE CARRIES REAL NUMBERS
//   Not "over-fulfilment" but: line "PF8-A" has 10 ordered and 7 already
//   fulfilled, so 3 remain, and this asks to ship 5. An operator reading the
//   first has to go and look; an operator reading the second already knows what
//   to type next.

/** Fields one entry of `line_fulfilments` accepts. */
export const LINE_FULFILMENT_FIELDS = ['sku', 'line_id', 'quantity'] as const

/**
 * One line the caller wants to ship units of, addressed EITHER by `sku` or by
 * `line_id`, never both.
 *
 * WHY TWO WAYS TO NAME A LINE, WHEN ONE WOULD BE SIMPLER
 *   `order_line_items` has no unique constraint on (order_id, sku), and that is
 *   deliberate — a real order can carry the same SKU on two lines (two
 *   different discounts, a gift copy alongside a bought one). SKU is therefore
 *   the name an operator actually says out loud, and is NOT guaranteed to
 *   identify one line. Refusing SKU entirely would make the common case
 *   awkward; accepting it silently when it is ambiguous would ship units
 *   against a line nobody chose. So: `sku` is accepted, and is REFUSED when it
 *   matches more than one line, with the matching line ids named so the caller
 *   can re-send addressed by `line_id`.
 */
export interface LineFulfilmentRequest {
  sku: string | null
  line_id: string | null
  quantity: number
}

/**
 * Validate the `line_fulfilments` array's SHAPE. It knows nothing about the
 * order — matching these against real lines is `planLineFulfilments`'s job,
 * because that needs the database and this file has no database handle.
 */
export function validateLineFulfilments(raw: unknown): Verdict<LineFulfilmentRequest[]> {
  if (!Array.isArray(raw)) {
    return no(
      'line_fulfilments must be an array of { sku or line_id, quantity } — say which lines shipped and how many',
    )
  }
  if (raw.length === 0) {
    return no('line_fulfilments is empty — an empty shipment moves nothing and records nothing')
  }

  const requests: LineFulfilmentRequest[] = []
  const seen = new Set<string>()

  for (const [index, entry] of raw.entries()) {
    const where = `line_fulfilments[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return no(`${where} is not an object`)
    }
    const item = entry as Record<string, unknown>

    const known = rejectUnknownFields(item, LINE_FULFILMENT_FIELDS)
    if (!known.ok) return no(`${where}: ${known.why}`)

    const hasSku = item.sku !== undefined && item.sku !== null
    const hasId = item.line_id !== undefined && item.line_id !== null
    if (hasSku && hasId) {
      return no(`${where}: pass either sku or line_id, not both — they could name different lines`)
    }
    if (!hasSku && !hasId) {
      return no(`${where}: name the line with either sku or line_id`)
    }

    let sku: string | null = null
    let lineId: string | null = null
    if (hasSku) {
      const checked = validateSku(item.sku)
      if (!checked.ok) return no(`${where}: ${checked.why}`)
      sku = checked.value
    } else {
      if (typeof item.line_id !== 'string' || item.line_id.trim() === '') {
        return no(`${where}: line_id must be a non-empty string`)
      }
      lineId = item.line_id.trim()
    }

    const quantity = validateWholeCount(item.quantity, 'quantity')
    if (!quantity.ok) return no(`${where}: ${quantity.why}`)
    if (quantity.value < 1) {
      // The same rule `validateAdjustment` applies to `delta` 0: an action that
      // moves nothing is not a smaller action, it is a green answer for
      // something that did not happen.
      return no(`${where}: quantity must be at least 1 — shipping 0 units of a line changes nothing`)
    }

    // Two entries naming the same line would either be applied twice or have
    // one of them silently lost, depending on write order. Neither is an answer
    // a caller can predict, so the request is refused instead.
    const key = sku !== null ? `sku:${sku}` : `line_id:${lineId}`
    if (seen.has(key)) {
      return no(
        `${where}: ${sku !== null ? `sku "${sku}"` : `line_id "${lineId}"`} appears more than once. ` +
          `Send one entry per line with the total you are shipping.`,
      )
    }
    seen.add(key)

    requests.push({ sku, line_id: lineId, quantity: quantity.value })
  }

  return ok(requests)
}

/** A line as the database holds it, for planning purposes. */
export interface OrderLineState {
  id: string
  sku: string
  quantity: number
  fulfilled_quantity: number
}

/** One line's planned move: ship `quantity` more, taking it to `next_fulfilled`. */
export interface PlannedLineFulfilment {
  line: OrderLineState
  quantity: number
  next_fulfilled: number
}

/** Units of a line that have not shipped yet. Never negative. */
export function lineRemaining(line: { quantity: number; fulfilled_quantity: number }): number {
  return Math.max(0, line.quantity - line.fulfilled_quantity)
}

/**
 * Match each request against a real line and refuse anything the order cannot
 * support — with the actual numbers in the message, every time.
 *
 * Pure: it plans, it does not write. The route runs the plan under
 * compare-and-swap and RE-CHECKS each line against its freshly-read value,
 * because a plan made from one read is a statement about the past the moment
 * another writer lands.
 */
export function planLineFulfilments(
  lines: OrderLineState[],
  requests: LineFulfilmentRequest[],
): Verdict<PlannedLineFulfilment[]> {
  if (lines.length === 0) {
    return no(
      'this order has no line items, so there is nothing to ship. An order with no lines is a total ' +
        'nobody can reconstruct — it needs fixing at ingest, not fulfilling.',
    )
  }

  const planned: PlannedLineFulfilment[] = []
  const claimedLineIds = new Set<string>()

  for (const request of requests) {
    let line: OrderLineState | undefined

    if (request.line_id !== null) {
      line = lines.find(l => l.id === request.line_id)
      if (!line) {
        return no(
          `this order has no line with line_id "${request.line_id}". Its lines are: ` +
            lines.map(l => `${l.id} (${l.sku})`).join(', '),
        )
      }
    } else {
      const matches = lines.filter(l => l.sku === request.sku)
      if (matches.length === 0) {
        return no(
          `this order has no line for sku "${request.sku}". It carries: ` +
            `${lines.map(l => l.sku).join(', ')}.`,
        )
      }
      if (matches.length > 1) {
        return no(
          `sku "${request.sku}" is on ${matches.length} of this order's lines ` +
            `(${matches.map(l => `${l.id}: ${l.fulfilled_quantity}/${l.quantity} fulfilled`).join('; ')}), ` +
            `so naming it by sku does not say which one to ship. Re-send that entry with line_id.`,
        )
      }
      line = matches[0]
    }

    // Two entries can still land on the same line when one names it by sku and
    // the other by line_id — `validateLineFulfilments` cannot see that, because
    // it never sees the order.
    if (claimedLineIds.has(line.id)) {
      return no(
        `line ${line.id} (sku "${line.sku}") is named twice in this request, once by sku and once by ` +
          `line_id. Send one entry per line with the total you are shipping.`,
      )
    }
    claimedLineIds.add(line.id)

    const remaining = lineRemaining(line)
    if (remaining === 0) {
      return no(
        `line "${line.sku}" (${line.id}) is already fulfilled in full — ${line.fulfilled_quantity} of ` +
          `${line.quantity} have shipped and 0 remain, so shipping ${request.quantity} more is not possible. ` +
          `A parcel that already left is a RETURN, which is a different object.`,
      )
    }
    if (request.quantity > remaining) {
      return no(
        `line "${line.sku}" (${line.id}) has ${line.quantity} ordered and ${line.fulfilled_quantity} already ` +
          `fulfilled, so ${remaining} remain — this asks to ship ${request.quantity}, which would take it to ` +
          `${line.fulfilled_quantity + request.quantity} of ${line.quantity}. Ship at most ${remaining}.`,
      )
    }

    planned.push({
      line,
      quantity: request.quantity,
      next_fulfilled: line.fulfilled_quantity + request.quantity,
    })
  }

  return ok(planned)
}

/**
 * The order's fulfilment state, DERIVED from its lines. Never asserted.
 *
 * THE EMPTY-ARRAY TRAP, NAMED RATHER THAN INHERITED
 *   `lines.every(...)` on an empty array is `true`, so the obvious
 *   implementation reports an order with no lines as FULLY FULFILLED — the most
 *   confident possible answer about an order nothing is known about. Empty
 *   returns 'unfulfilled' here, and callers that care refuse the order outright
 *   (see `planLineFulfilments`).
 *
 * It never returns 'cancelled': cancellation is an operator's decision about an
 * order, not a fact about how many units left the warehouse, and no arrangement
 * of line quantities can express it.
 */
export function deriveFulfilmentStatus(
  lines: readonly { quantity: number; fulfilled_quantity: number }[],
): FulfilmentStatus {
  if (lines.length === 0) return 'unfulfilled'
  const shipped = lines.reduce((sum, l) => sum + l.fulfilled_quantity, 0)
  if (shipped === 0) return 'unfulfilled'
  return lines.every(l => l.fulfilled_quantity >= l.quantity) ? 'fulfilled' : 'partially_fulfilled'
}

/**
 * A caller may state the `fulfilment_status` it expects alongside
 * `line_fulfilments`. If it disagrees with what the lines actually say, the
 * whole request is refused — the same stance `validateNewOrder` takes when a
 * stated total disagrees with the sum of the lines.
 */
export function checkStatedStatusAgainstLines(
  stated: unknown,
  derived: FulfilmentStatus,
  detail: string,
): Verdict<FulfilmentStatus> {
  if (!isFulfilmentStatus(stated)) {
    return no(
      `"${String(stated)}" is not a fulfilment state. Known states: ${FULFILMENT_STATES.join(', ')}`,
    )
  }
  if (stated === derived) return ok(derived)
  if (stated === 'cancelled') {
    return no(
      'cancelled cannot be reached by shipping units — it is a decision about the order, not a count of ' +
        'what left the warehouse. Send fulfilment_status: "cancelled" on its own, with no line_fulfilments.',
    )
  }
  return no(
    `these line quantities make this order ${derived}, not ${stated} (${detail}). An order whose stated ` +
      `fulfilment disagrees with its own lines is a reconciliation failure, not a rounding one — omit ` +
      `fulfilment_status and it will be derived, or send the quantities that actually make it ${stated}.`,
  )
}
