// lib/__tests__/commerce.test.ts — commerce-operations piece (Wave 7)
//
// The bias of this file is deliberate: most of it proves the commerce path
// REFUSES. A suite that only shows the happy path passing cannot tell a
// working validator from a deleted one — and every refusal below is a defect
// that would otherwise reach the database:
//
//   * "19.999" stored as a USD price      -> silently truncated money
//   * a currency nobody knows the exponent of -> every amount wrong by 100x
//   * an unknown field in a write body    -> a caller who thinks it landed
//   * a stock adjustment with no reason   -> stock nobody can account for
//   * an adjustment past zero             -> negative physical inventory
//   * fulfilled -> unfulfilled            -> un-shipping a shipped parcel
//   * moving to the state already held    -> a green answer for a no-op
//
// Every refusal test is paired with the same input ACCEPTED once the one
// unsafe thing is fixed, so a validator that refuses everything fails this
// suite exactly as loudly as one that refuses nothing.

import {
  CURRENCY_EXPONENT,
  FULFILMENT_STATES,
  PRODUCT_STATUSES,
  SUPPORTED_CURRENCIES,
  applyAdjustment,
  canFulfilmentTransition,
  checkFulfilmentTransition,
  currencyExponent,
  describeMoney,
  formatMinor,
  parseAmountToMinor,
  rejectUnknownFields,
  resolveCommerceScope,
  unscopedCommerceMessage,
  validateAdjustment,
  validateNewOrder,
  validateNewProduct,
  validateSku,
  type FulfilmentStatus,
} from '../commerce'

/** Unwrap a verdict that must have succeeded, with a readable failure. */
function value<T>(v: { ok: true; value: T } | { ok: false; why: string }): T {
  if (!v.ok) throw new Error(`expected ok, got refusal: ${v.why}`)
  return v.value
}

/** Assert a verdict refused, and hand back the reason so it can be inspected. */
function refusal<T>(v: { ok: true; value: T } | { ok: false; why: string }): string {
  if (v.ok) throw new Error(`expected a refusal, got value ${JSON.stringify(v.value)}`)
  expect(v.why).not.toBe('')
  return v.why
}

// ─── A. Money is not a float ────────────────────────────────────────────────

describe('parseAmountToMinor — exact integer minor units, no float anywhere', () => {
  it('parses two-decimal currencies exactly', () => {
    expect(value(parseAmountToMinor('19.99', 'USD'))).toBe(1999)
    expect(value(parseAmountToMinor('0.10', 'USD'))).toBe(10)
    expect(value(parseAmountToMinor('0.05', 'USD'))).toBe(5)
    expect(value(parseAmountToMinor('0', 'USD'))).toBe(0)
    expect(value(parseAmountToMinor('1', 'USD'))).toBe(100)
    expect(value(parseAmountToMinor('1.5', 'USD'))).toBe(150)
    expect(value(parseAmountToMinor('  12.34  ', 'EUR'))).toBe(1234)
    expect(value(parseAmountToMinor('+7.00', 'GBP'))).toBe(700)
  })

  it('honours a currency with NO minor unit instead of assuming two decimals', () => {
    // The whole reason CURRENCY_EXPONENT is a table: ¥1500 is 1500 minor
    // units, not 150000. Assuming 2 would multiply every yen amount by 100.
    expect(CURRENCY_EXPONENT.JPY).toBe(0)
    expect(value(parseAmountToMinor('1500', 'JPY'))).toBe(1500)
    refusal(parseAmountToMinor('15.00', 'JPY'))
  })

  it('is exact where a float is not — 0.1 + 0.2 in minor units is 0.30, not 0.30000000000000004', () => {
    const a = value(parseAmountToMinor('0.1', 'USD'))
    const b = value(parseAmountToMinor('0.2', 'USD'))
    expect(a + b).toBe(30)
    expect(formatMinor(a + b, 'USD')).toBe('0.30')
    // The float route, shown for contrast — this is the defect being avoided.
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it('is exact at a magnitude where parseFloat * 100 is not', () => {
    // parseFloat('8114.35') * 100 === 811434.9999999999
    expect(value(parseAmountToMinor('8114.35', 'USD'))).toBe(811435)
    expect(value(parseAmountToMinor('1234567.89', 'USD'))).toBe(123456789)
  })

  it('refuses more decimal places than the currency has', () => {
    expect(refusal(parseAmountToMinor('19.999', 'USD'))).toMatch(/2 decimal places/)
    // ...and accepts the same amount once the one unsafe thing is fixed.
    expect(value(parseAmountToMinor('19.99', 'USD'))).toBe(1999)
  })

  it.each([
    ['1e2', 'exponent notation'],
    ['12.34.5', 'two decimal points'],
    ['1,299.00', 'a thousands separator'],
    ['$19.99', 'a currency symbol'],
    ['NaN', 'the string NaN'],
    ['Infinity', 'the string Infinity'],
    ['', 'an empty string'],
    ['   ', 'blank space'],
    ['.', 'a bare point'],
    ['abc', 'letters'],
  ])('refuses %s (%s)', raw => {
    refusal(parseAmountToMinor(raw, 'USD'))
  })

  it('refuses a negative price, and allows one only where asked for explicitly', () => {
    refusal(parseAmountToMinor('-5', 'USD'))
    expect(value(parseAmountToMinor('-5', 'USD', { allowNegative: true }))).toBe(-500)
  })

  it('refuses a number-typed input that is not already an exact integer', () => {
    // 19.99 as a JS number has already been through a float; its exactness
    // cannot be recovered, so it is refused rather than rounded.
    refusal(parseAmountToMinor(19.99, 'USD'))
    refusal(parseAmountToMinor(NaN, 'USD'))
    refusal(parseAmountToMinor(Infinity, 'USD'))
    expect(value(parseAmountToMinor(1999, 'USD'))).toBe(1999)
  })

  it('refuses an unknown currency rather than assuming two decimals', () => {
    const why = refusal(parseAmountToMinor('10.00', 'XYZ'))
    expect(why).toMatch(/unsupported currency/i)
    // The refusal names what IS supported, so the caller can act on it.
    for (const code of SUPPORTED_CURRENCIES) expect(why).toContain(code)
    refusal(currencyExponent('US'))
    refusal(currencyExponent('usdd'))
    expect(value(currencyExponent('usd'))).toBe(2)
  })
})

describe('formatMinor — the exact inverse', () => {
  it('renders minor units back to a decimal string', () => {
    expect(formatMinor(1999, 'USD')).toBe('19.99')
    expect(formatMinor(5, 'USD')).toBe('0.05')
    expect(formatMinor(0, 'USD')).toBe('0.00')
    expect(formatMinor(100, 'USD')).toBe('1.00')
    expect(formatMinor(1500, 'JPY')).toBe('1500')
    expect(formatMinor(-250, 'USD')).toBe('-2.50')
    expect(describeMoney(1999, 'usd')).toBe('19.99 USD')
  })

  it('round-trips: parse(format(n)) === n for every value tried', () => {
    const values = [0, 1, 5, 9, 10, 99, 100, 101, 999, 1000, 1999, 100000, 811435, 123456789]
    for (const currency of ['USD', 'EUR', 'JPY']) {
      for (const n of values) {
        expect(value(parseAmountToMinor(formatMinor(n, currency), currency))).toBe(n)
      }
    }
  })
})

// ─── B. The fulfilment state machine ────────────────────────────────────────

describe('canFulfilmentTransition — every ordered pair of states', () => {
  const LEGAL: ReadonlyArray<[FulfilmentStatus, FulfilmentStatus]> = [
    ['unfulfilled', 'partially_fulfilled'],
    ['unfulfilled', 'fulfilled'],
    ['unfulfilled', 'cancelled'],
    ['partially_fulfilled', 'fulfilled'],
    ['partially_fulfilled', 'cancelled'],
  ]

  it('allows exactly the five legal moves and refuses the other eleven', () => {
    let allowed = 0
    for (const from of FULFILMENT_STATES) {
      for (const to of FULFILMENT_STATES) {
        const expected = LEGAL.some(([f, t]) => f === from && t === to)
        expect({ from, to, allowed: canFulfilmentTransition(from, to) }).toEqual({
          from,
          to,
          allowed: expected,
        })
        if (expected) allowed++
      }
    }
    expect(allowed).toBe(5)
    // 4 states x 4 states = 16 pairs; 5 legal means 11 refused.
    expect(FULFILMENT_STATES.length * FULFILMENT_STATES.length - allowed).toBe(11)
  })

  it('there is no un-shipping: fulfilled is terminal', () => {
    for (const to of FULFILMENT_STATES) {
      expect(canFulfilmentTransition('fulfilled', to)).toBe(false)
    }
    expect(refusal(checkFulfilmentTransition('fulfilled', 'unfulfilled'))).toMatch(
      /fulfilled is final/,
    )
  })

  it('cancelled is terminal in the other direction', () => {
    for (const to of FULFILMENT_STATES) {
      expect(canFulfilmentTransition('cancelled', to)).toBe(false)
    }
    expect(refusal(checkFulfilmentTransition('cancelled', 'fulfilled'))).toMatch(/cancelled is final/)
  })

  it('refuses a move to the state the order already holds — no silent no-op success', () => {
    for (const state of FULFILMENT_STATES) {
      expect(refusal(checkFulfilmentTransition(state, state))).toMatch(/already/)
    }
  })

  it('refuses a state outside the enumerated set, naming the set', () => {
    const why = refusal(checkFulfilmentTransition('unfulfilled', 'shipped'))
    for (const state of FULFILMENT_STATES) expect(why).toContain(state)
    refusal(checkFulfilmentTransition('unfulfilled', ''))
    refusal(checkFulfilmentTransition('unfulfilled', null))
    refusal(checkFulfilmentTransition('nonsense', 'fulfilled'))
    // ...and the legal move still passes.
    expect(value(checkFulfilmentTransition('unfulfilled', 'fulfilled'))).toBe('fulfilled')
  })
})

// ─── C. Writes refuse before they store ─────────────────────────────────────

describe('rejectUnknownFields — the hub-settings stance', () => {
  it('refuses a field the endpoint does not implement, naming it and the accepted set', () => {
    const why = refusal(rejectUnknownFields({ sku: 'A', price_usd: '19.99' }, ['sku', 'price']))
    expect(why).toContain('price_usd')
    expect(why).toContain('sku')
    expect(why).toContain('price')
  })

  it('accepts a body using only known fields, including an empty one', () => {
    expect(value(rejectUnknownFields({ sku: 'A' }, ['sku', 'price']))).toBe(true)
    expect(value(rejectUnknownFields({}, ['sku']))).toBe(true)
  })
})

describe('validateSku', () => {
  it('accepts a plain code and trims it', () => {
    expect(value(validateSku(' LG-CANDLE-01 '))).toBe('LG-CANDLE-01')
  })
  it.each([
    ['missing', undefined],
    ['blank', ''],
    ['whitespace only', '   '],
    ['contains spaces', 'LG CANDLE 01'],
    ['contains a tab', 'LG\tCANDLE'],
    ['not a string', 42],
  ])('refuses a sku that is %s', (_label, raw) => {
    refusal(validateSku(raw))
  })
  it('refuses an over-long sku and names the limit', () => {
    expect(refusal(validateSku('X'.repeat(65)))).toContain('64')
    expect(value(validateSku('X'.repeat(64)))).toHaveLength(64)
  })
})

describe('validateNewProduct — every refusal, then the same body accepted', () => {
  const GOOD = { sku: 'LG-CANDLE-01', title: 'Amber Candle', price: '19.99', currency: 'USD' }

  it('accepts a complete, well-formed product', () => {
    expect(value(validateNewProduct({ ...GOOD }))).toEqual({
      sku: 'LG-CANDLE-01',
      title: 'Amber Candle',
      status: 'draft',
      price_minor: 1999,
      currency: 'USD',
      reorder_point: 0,
    })
  })

  it.each([
    ['a missing sku', { ...GOOD, sku: undefined }],
    ['a blank title', { ...GOOD, title: '   ' }],
    ['a missing title', { ...GOOD, title: undefined }],
    ['a price with too many decimals', { ...GOOD, price: '19.999' }],
    ['no price at all', { sku: GOOD.sku, title: GOOD.title, currency: 'USD' }],
    ['both price and price_minor', { ...GOOD, price_minor: 1999 }],
    ['an unsupported currency', { ...GOOD, currency: 'XYZ' }],
    ['a status outside the set', { ...GOOD, status: 'live' }],
    ['a negative reorder point', { ...GOOD, reorder_point: -1 }],
    ['an unknown field', { ...GOOD, discount_pct: 10 }],
  ])('refuses %s', (_label, body) => {
    refusal(validateNewProduct(body as Record<string, unknown>))
  })

  it('accepts price_minor as an exact integer alternative to a typed price', () => {
    const p = value(validateNewProduct({ sku: 'A-1', title: 'A', price_minor: 1999, currency: 'USD' }))
    expect(p.price_minor).toBe(1999)
  })

  it('accepts every status in the enumerated set and nothing else', () => {
    for (const status of PRODUCT_STATUSES) {
      expect(value(validateNewProduct({ ...GOOD, status })).status).toBe(status)
    }
    refusal(validateNewProduct({ ...GOOD, status: 'archived_soon' }))
  })
})

// ─── D. The inventory action ────────────────────────────────────────────────

describe('validateAdjustment — a stock change an operator can be held to', () => {
  const GOOD = { sku: 'LG-CANDLE-01', delta: -3, reason: 'damaged in transit' }

  it('accepts a well-formed adjustment and defaults the location', () => {
    expect(value(validateAdjustment({ ...GOOD }))).toEqual({
      sku: 'LG-CANDLE-01',
      location: 'default',
      delta: -3,
      reason: 'damaged in transit',
    })
  })

  it('requires a reason — the whole point of the audit row', () => {
    expect(refusal(validateAdjustment({ sku: GOOD.sku, delta: -3 }))).toMatch(/reason is required/)
    refusal(validateAdjustment({ ...GOOD, reason: '   ' }))
    refusal(validateAdjustment({ ...GOOD, reason: 'x'.repeat(281) }))
    // ...and the same adjustment lands once a reason is given.
    expect(value(validateAdjustment({ ...GOOD })).reason).toBe('damaged in transit')
  })

  it.each([
    ['zero', 0],
    ['a fraction', 1.5],
    ['a float string', '2.5'],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['missing', undefined],
    ['a word', 'lots'],
  ])('refuses delta %s', (_label, delta) => {
    refusal(validateAdjustment({ ...GOOD, delta }))
  })

  it('accepts a whole-number delta given as a string, in both directions', () => {
    expect(value(validateAdjustment({ ...GOOD, delta: '12' })).delta).toBe(12)
    expect(value(validateAdjustment({ ...GOOD, delta: '-12' })).delta).toBe(-12)
  })

  it('refuses an unknown field on the adjustment body', () => {
    expect(refusal(validateAdjustment({ ...GOOD, on_hand: 40 }))).toContain('on_hand')
  })
})

describe('applyAdjustment — stock cannot go below zero', () => {
  it('applies a legal delta', () => {
    expect(value(applyAdjustment(12, -4))).toBe(8)
    expect(value(applyAdjustment(0, 5))).toBe(5)
    expect(value(applyAdjustment(4, -4))).toBe(0)
  })

  it('refuses a delta that would take stock negative, naming both numbers', () => {
    const why = refusal(applyAdjustment(3, -5))
    expect(why).toContain('3')
    expect(why).toContain('-5')
    expect(why).toMatch(/below zero/)
    // ...and the same level accepts the delta that fits.
    expect(value(applyAdjustment(3, -3))).toBe(0)
  })

  it('refuses a nonsense current level or delta rather than computing with it', () => {
    refusal(applyAdjustment(-1, 1))
    refusal(applyAdjustment(1.5, 1))
    refusal(applyAdjustment(10, 1.5))
    refusal(applyAdjustment(10, NaN))
  })
})

// ─── E. Scope fails closed ──────────────────────────────────────────────────

describe('resolveCommerceScope — refuses rather than widens', () => {
  it('uses the server-resolved scope when there is one', () => {
    const v = resolveCommerceScope('Limiglow', null)
    expect(v).toEqual({ ok: true, project: 'Limiglow' })
  })

  it('accepts an explicit project for a caller with no browser context', () => {
    expect(resolveCommerceScope(null, 'Limiglow')).toEqual({ ok: true, project: 'Limiglow' })
  })

  it('refuses when nothing resolves, and says how to ask deliberately', () => {
    const v = resolveCommerceScope(null, null)
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error('unreachable')
    expect(v.status).toBe(400)
    expect(v.error).toBe('unscoped_commerce_read')
    expect(v.why).toMatch(/\/p\/<project>/)
    expect(v.why).toMatch(/project=<name>/)
    // It offers no widening escape, and says so.
    expect(v.why).toMatch(/no all-projects mode/i)
    expect(unscopedCommerceMessage('commerce query')).toBe(v.why)
  })

  it('names a write as a write, so the two are distinguishable in logs', () => {
    const v = resolveCommerceScope(null, null, 'write')
    if (v.ok) throw new Error('unreachable')
    expect(v.error).toBe('unscoped_commerce_write')
  })

  it('refuses a requested project that disagrees with the resolved one — 409, not silence', () => {
    const v = resolveCommerceScope('Limiglow', 'Todero')
    if (v.ok) throw new Error('unreachable')
    expect(v.status).toBe(409)
    expect(v.error).toBe('scope_mismatch')
    expect(v.why).toContain('Limiglow')
    expect(v.why).toContain('Todero')
    // Agreement is fine.
    expect(resolveCommerceScope('Limiglow', 'Limiglow')).toEqual({ ok: true, project: 'Limiglow' })
  })
})

// ─── F. Order ingest — the total must equal the lines ───────────────────────

describe('validateNewOrder', () => {
  const LINE = { sku: 'LG-CANDLE-01', title: 'Amber Candle', quantity: 2, unit_price: '19.99' }
  const GOOD = { order_number: 'LG-1001', currency: 'USD', line_items: [LINE] }

  it('computes the total from the lines with exact integer arithmetic', () => {
    const order = value(validateNewOrder({ ...GOOD }))
    expect(order.total_minor).toBe(3998) // 2 x 1999, exactly
    expect(formatMinor(order.total_minor, 'USD')).toBe('39.98')
    expect(order.fulfilment_status).toBe('unfulfilled')
    expect(order.line_items).toHaveLength(1)
    expect(order.line_items[0].unit_price_minor).toBe(1999)
  })

  it('sums many lines without drift — the reason money is an integer at all', () => {
    // Ten lines of 0.10 is 1.00 exactly. Ten floats of 0.1 sum to
    // 0.9999999999999999, which is what this representation prevents.
    const lines = Array.from({ length: 10 }, (_, i) => ({
      sku: `LG-${i}`,
      title: `Item ${i}`,
      quantity: 1,
      unit_price: '0.10',
    }))
    const order = value(validateNewOrder({ order_number: 'LG-1002', currency: 'USD', line_items: lines }))
    expect(order.total_minor).toBe(100)
    expect(formatMinor(order.total_minor, 'USD')).toBe('1.00')
  })

  it('REFUSES a stated total that disagrees with the lines', () => {
    const why = refusal(validateNewOrder({ ...GOOD, total: '39.99' }))
    expect(why).toMatch(/does not[\s\S]*equal the lines/)
    // ...and accepts the same order once the stated total matches.
    expect(value(validateNewOrder({ ...GOOD, total: '39.98' })).total_minor).toBe(3998)
    expect(value(validateNewOrder({ ...GOOD, total_minor: 3998 })).total_minor).toBe(3998)
  })

  it.each([
    ['no order_number', { currency: 'USD', line_items: [LINE] }],
    ['a blank order_number', { ...GOOD, order_number: '   ' }],
    ['no line items', { order_number: 'LG-1', currency: 'USD', line_items: [] }],
    ['line items that are not an array', { order_number: 'LG-1', currency: 'USD', line_items: 'two' }],
    ['a line with no title', { ...GOOD, line_items: [{ ...LINE, title: '' }] }],
    ['a line with quantity 0', { ...GOOD, line_items: [{ ...LINE, quantity: 0 }] }],
    ['a line with a fractional quantity', { ...GOOD, line_items: [{ ...LINE, quantity: 1.5 }] }],
    ['a line with no price', { ...GOOD, line_items: [{ sku: 'A', title: 'A', quantity: 1 }] }],
    ['a line priced to 3 decimals', { ...GOOD, line_items: [{ ...LINE, unit_price: '19.999' }] }],
    ['a line with an unknown field', { ...GOOD, line_items: [{ ...LINE, discount: 1 }] }],
    ['an unsupported currency', { ...GOOD, currency: 'XYZ' }],
    ['an unknown top-level field', { ...GOOD, gift_note: 'hi' }],
    ['a fulfilment state outside the set', { ...GOOD, fulfilment_status: 'shipped' }],
    ['a placed_at that is not a date', { ...GOOD, placed_at: 'yesterday' }],
    ['a customer_email that is not one', { ...GOOD, customer_email: 'not-an-email' }],
  ])('refuses an order with %s', (_label, body) => {
    refusal(validateNewOrder(body as Record<string, unknown>))
  })

  it('accepts an order that arrives already fulfilled — ingest is not a MOVE', () => {
    // The state machine governs transitions an operator makes. A storefront
    // reporting an order that already shipped is not a transition.
    expect(value(validateNewOrder({ ...GOOD, fulfilment_status: 'fulfilled' })).fulfilment_status).toBe(
      'fulfilled',
    )
  })
})
