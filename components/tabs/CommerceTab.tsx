'use client'

// components/tabs/CommerceTab.tsx — commerce-operations piece (Wave 7).
//
// The Commerce destination's card treatment: orders, catalogue and inventory
// as objects an operator ACTS on. The channel goal names the failure mode this
// avoids — "not a dashboard that only reports what happened" — so the
// Inventory card carries a real adjust control that writes through
// PATCH /api/commerce/inventory and re-reads the level, and the Orders card
// advances an order's fulfilment state through PATCH /api/commerce/orders.
//
// WHAT IS NOT HERE
//   No hardcoded product, order or stock level. Every number and every row on
//   this screen comes from the query printed above it. An empty catalogue
//   renders as "Limiglow has no products yet" — the TRUE state of a storefront
//   that has not been imported yet, and not a populated demo somebody might act
//   on. This repo has shipped hardcoded arrays rendered as live data before.
//
// THE CONTRACT (components/nav/Card.tsx)
//   One question as the title, one number from a real query, that query printed
//   as `source`, one action or none, an empty state that names the project, and
//   an error that REPLACES the body — never an empty state rendered over a
//   failed request, which tells the operator there is no work when the truth is
//   that nobody asked.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'

interface OrderView {
  order_number: string
  total_display: string
  fulfilment_status: string
  customer_email: string | null
}

/** One line of one order, as GET ?order_number= returns it. `line_id` is the
 *  only unambiguous way to address a line — an order can carry the same SKU
 *  twice — so it is what the ship control sends. */
interface LineView {
  line_id: string
  sku: string
  title: string
  quantity: number
  fulfilled_quantity: number
  remaining: number
}

interface ProductView {
  sku: string
  title: string
  status: string
  price_display: string
}

interface LevelView {
  sku: string
  location: string
  on_hand: number
  reorder_point: number
  below_reorder: boolean
}

/** One loaded endpoint: its rows, its EXACT total, and any failure, kept apart.
 *  `total` stays null until a real number arrives — a card never renders a
 *  fabricated 0 while the count is in flight. */
interface Loaded<T> {
  rows: T[]
  total: number | null
  error: ApiError | null
  loaded: boolean
}

const EMPTY = { rows: [], total: null, error: null, loaded: false }

function useEndpoint<T>(url: string | null, pick: (body: unknown) => T[]): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>(EMPTY as Loaded<T>)

  const load = useCallback(async () => {
    if (!url) return
    try {
      const res = await fetch(url)
      if (!res.ok) {
        setState({ rows: [], total: null, error: await readApiError(res, url), loaded: true })
        return
      }
      const body = (await res.json()) as { total?: unknown }
      setState({
        rows: pick(body),
        // `total` is the route's exact count, never rows.length of a page.
        total: typeof body.total === 'number' ? body.total : null,
        error: null,
        loaded: true,
      })
    } catch (e) {
      setState({
        rows: [],
        total: null,
        error: { status: 0, endpoint: url, message: e instanceof Error ? e.message : 'could not reach the server' },
        loaded: true,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  useEffect(() => { void load() }, [load])
  return [state, load]
}

const ROW = 'flex items-center justify-between gap-3 py-1.5 border-b border-white/5 last:border-0 text-xs'

export interface CommerceTabProps {
  /** Project scope. Null means the app has not resolved one yet — the cards
   *  then say so rather than reading across every storefront. */
  projectFilter: string | null
}

export default function CommerceTab({ projectFilter }: CommerceTabProps) {
  const p = projectFilter ? encodeURIComponent(projectFilter) : null

  const ordersUrl = p ? `/api/commerce/orders?project=${p}&fulfilment_status=unfulfilled&limit=10` : null
  // "Waiting to ship" is NOT the same set as "unfulfilled". An order that is
  // partly shipped is still waiting for the rest of it, and before this second
  // query the card listed only `unfulfilled` — so the moment an operator
  // shipped one line, the order vanished from the only screen that lists
  // orders and there was no way to ship the rest of it. Two queries rather
  // than one client-side filter, because `total` must stay the route's exact
  // count of each set and never a page length.
  const partialUrl = p ? `/api/commerce/orders?project=${p}&fulfilment_status=partially_fulfilled&limit=10` : null
  const productsUrl = p ? `/api/commerce/products?project=${p}&status=active&limit=10` : null
  const levelsUrl = p ? `/api/commerce/inventory?project=${p}&limit=25` : null
  const lowUrl = p ? `/api/commerce/inventory?project=${p}&below_reorder=1&limit=1` : null

  const [orders, reloadOrders] = useEndpoint<OrderView>(ordersUrl, b => ((b as { orders?: OrderView[] }).orders ?? []))
  const [partial, reloadPartial] = useEndpoint<OrderView>(partialUrl, b => ((b as { orders?: OrderView[] }).orders ?? []))
  const [products] = useEndpoint<ProductView>(productsUrl, b => ((b as { products?: ProductView[] }).products ?? []))
  const [levels, reloadLevels] = useEndpoint<LevelView>(levelsUrl, b => ((b as { levels?: LevelView[] }).levels ?? []))
  const [low, reloadLow] = useEndpoint<LevelView>(lowUrl, b => ((b as { levels?: LevelView[] }).levels ?? []))

  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // `advance()` used to ignore the PATCH response entirely — a
  // refused transition (permission denied, illegal state, a 500) reloaded the
  // same unfulfilled list and looked, to the operator, exactly like a
  // successful click that happened to do nothing. `orderActionError` is the
  // same surfaced-refusal pattern `adjustError` already uses below.
  const [orderActionError, setOrderActionError] = useState<string | null>(null)

  // Per-line shipping (migration 074). An order expands to its lines, each with
  // how many of it have already gone, and a box for how many are going now.
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  const [lines, setLines] = useState<LineView[] | null>(null)
  const [linesError, setLinesError] = useState<string | null>(null)
  const [shipQty, setShipQty] = useState<Record<string, string>>({})

  /** Waiting-to-ship = unfulfilled + partly shipped. Kept as one list so the
   *  operator sees one queue, with each order's own status on its row. */
  const waiting = [...orders.rows, ...partial.rows]
  // EITHER half missing means there is no count, not a smaller one. This read
  // `orders.total === null && partial.total === null` — both — so when exactly
  // one of the two queries failed the other's number was rendered on its own as
  // a confident total: "5 waiting" in the metric slot, directly above an
  // ApiErrorBanner saying the other half never arrived. The empty state below
  // is already guarded by `!waitingError`; the metric was not. An undercount
  // presented as a count is the same defect as an empty list over a failed
  // request, one line higher up the card.
  const waitingTotal =
    orders.total === null || partial.total === null ? null : orders.total + partial.total
  const waitingLoaded = orders.loaded && partial.loaded
  const waitingError = orders.error ?? partial.error

  const reloadAllOrders = useCallback(() => {
    reloadOrders()
    reloadPartial()
  }, [reloadOrders, reloadPartial])

  /** Always (re)reads one order's lines. `openLines` below toggles; this does
   *  not — a refused shipment must be able to refresh what it is showing
   *  without collapsing the panel the operator is reading. */
  async function loadLines(orderNumber: string) {
    if (!projectFilter) return
    setLines(null)
    setLinesError(null)
    const url = `/api/commerce/orders?project=${encodeURIComponent(projectFilter)}&order_number=${encodeURIComponent(orderNumber)}`
    try {
      const res = await fetch(url)
      const body = (await res.json().catch(() => ({}))) as { line_items?: LineView[]; message?: string }
      if (!res.ok) {
        // The card's own rule: never render an empty line list over a failed
        // request. An operator seeing "no lines" must mean the order has none,
        // not that nobody managed to ask.
        setLinesError(body.message ?? `could not read ${orderNumber}'s lines (${res.status})`)
        return
      }
      setLines(body.line_items ?? [])
    } catch (e) {
      setLinesError(e instanceof Error ? e.message : 'could not reach the server')
    }
  }

  function openLines(orderNumber: string) {
    if (openOrder === orderNumber) {
      setOpenOrder(null)
      return
    }
    setOpenOrder(orderNumber)
    void loadLines(orderNumber)
  }

  async function shipLine(orderNumber: string, lineId: string) {
    if (!projectFilter) return
    setOrderActionError(null)
    const quantity = shipQty[lineId] ?? ''
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: projectFilter,
          order_number: orderNumber,
          // Sent as typed. The server's validator refuses a non-number with a
          // message naming what arrived; parsing it here would either hide
          // that or invent a second, quieter rule.
          line_fulfilments: [{ line_id: lineId, quantity: /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : quantity }],
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        // Verbatim, as everywhere else on this card: the server's refusal
        // already names the ordered / fulfilled / remaining numbers, and
        // paraphrasing would drop exactly the part the operator needs.
        setOrderActionError(`${orderNumber}: ${body.message ?? `the shipment was refused (${res.status})`}`)
        // A 409 means the line's ACTUAL state moved out from under this click —
        // a concurrent shipment took the units. Re-read so the numbers on
        // screen match the ones the refusal just quoted. A 422 (over-fulfilment,
        // bad quantity) and a 403 mean nothing moved, so those leave the panel
        // as it is.
        if (res.status === 409) void loadLines(orderNumber)
        return
      }
      setShipQty(q => ({ ...q, [lineId]: '' }))
      // Re-read the lines, the order queue and the stock levels: one shipment
      // moved all three.
      void loadLines(orderNumber)
      reloadAllOrders()
      reloadLevels()
      reloadLow()
    } catch (e) {
      setOrderActionError(`${orderNumber}: ${e instanceof Error ? e.message : 'could not reach the server'}`)
    }
  }

  async function submitAdjustment(sku: string, location: string) {
    if (!projectFilter) return
    setBusy(true)
    setAdjustError(null)
    try {
      const res = await fetch('/api/commerce/inventory', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectFilter, sku, location, delta, reason }),
      })
      const body = (await res.json()) as { message?: string }
      if (!res.ok) {
        // The server's own refusal, shown verbatim. It already says which
        // number was refused and why; paraphrasing it here would lose that.
        setAdjustError(body.message ?? `the adjustment was refused (${res.status})`)
        return
      }
      setAdjusting(null)
      setDelta('')
      setReason('')
      reloadLevels()
      reloadLow()
    } catch (e) {
      setAdjustError(e instanceof Error ? e.message : 'could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  async function advance(orderNumber: string, to: string) {
    if (!projectFilter) return
    setOrderActionError(null)
    try {
      const res = await fetch('/api/commerce/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: projectFilter, order_number: orderNumber, fulfilment_status: to }),
      })
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) {
        // The server's own refusal, shown verbatim — the same stance
        // submitAdjustment already takes below. Without this, a refused
        // transition reloaded the identical unfulfilled list and looked
        // exactly like a click that silently did nothing.
        setOrderActionError(`${orderNumber}: ${body.message ?? `the transition was refused (${res.status})`}`)
        // A 409 means the order's ACTUAL state moved out from under this
        // click (someone else already fulfilled it, or the read this button
        // was drawn from was already stale) — the list still shows the order
        // as unfulfilled unless it is reloaded here too. Every other refusal
        // (403 permission, 422 bad state, a 500) does not mean the order
        // changed, so only 409 reloads.
        if (res.status === 409) reloadAllOrders()
        return
      }
      setOpenOrder(null)
      reloadAllOrders()
      reloadLevels()
      reloadLow()
    } catch (e) {
      setOrderActionError(`${orderNumber}: ${e instanceof Error ? e.message : 'could not reach the server'}`)
    }
  }

  if (!projectFilter) {
    return (
      <div className="space-y-3">
        <Card
          id="commerce-unscoped"
          title="Which storefront?"
          source="/api/commerce/* — waiting for a project scope"
          empty={{
            active: true,
            message:
              'No project selected yet. Todero operates one storefront at a time, so there is nothing scoped to show.',
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Orders ─────────────────────────────────────────────────────── */}
      <Card
        id="commerce-orders"
        title="Which orders are waiting to ship?"
        source={
          <>
            {ordersUrl}
            <br />
            {partialUrl}
          </>
        }
        metric={
          waitingLoaded && waitingTotal !== null
            ? {
                value: waitingTotal.toLocaleString('en-US'),
                label:
                  partial.total && partial.total > 0
                    ? `waiting (${partial.total} part-shipped)`
                    : 'waiting to ship',
                tone: waitingTotal > 0 ? 'amber' : 'default',
              }
            : undefined
        }
        empty={
          waitingLoaded && !waitingError && waitingTotal === 0
            ? { active: true, message: `${projectFilter} has no orders waiting to ship — none unfulfilled, none part-shipped.` }
            : undefined
        }
      >
        {waitingError ? (
          <ApiErrorBanner error={waitingError} onRetry={reloadAllOrders} />
        ) : (
          <div>
            {waiting.map(o => (
              <div key={o.order_number}>
                <div className={ROW}>
                  <span className="font-mono text-white/80 truncate">{o.order_number}</span>
                  {o.fulfilment_status === 'partially_fulfilled' && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-amber-400/30 text-amber-300/90">
                      part-shipped
                    </span>
                  )}
                  <span className="text-white/50 truncate flex-1 min-w-0">{o.customer_email ?? '—'}</span>
                  <span className="text-white/80 font-mono">{o.total_display}</span>
                  <button
                    onClick={() => openLines(o.order_number)}
                    aria-expanded={openOrder === o.order_number}
                    className="shrink-0 text-[11px] px-2 py-0.5 rounded-md border border-white/15 text-white/70 hover:text-white transition-colors"
                  >
                    {openOrder === o.order_number ? 'Hide lines' : 'Ship lines'}
                  </button>
                  <button
                    onClick={() => void advance(o.order_number, 'fulfilled')}
                    className="shrink-0 text-[11px] px-2 py-0.5 rounded-md border border-white/15 text-white/70 hover:text-white transition-colors"
                  >
                    Ship the rest
                  </button>
                </div>

                {/* Per-line shipping. The whole point of migration 074: an
                    order is not one all-or-nothing switch, it is a set of lines
                    each of which can go in parts. */}
                {openOrder === o.order_number && (
                  <div className="pl-3 pb-2 border-l border-white/10 ml-1">
                    {linesError ? (
                      // Never an empty line list over a failed read.
                      <p role="alert" className="py-2 text-[11px] text-red-400 leading-snug">
                        {linesError}
                      </p>
                    ) : lines === null ? (
                      <p className="py-2 text-[11px] text-white/40">reading {o.order_number}&rsquo;s lines…</p>
                    ) : lines.length === 0 ? (
                      <p className="py-2 text-[11px] text-white/40">
                        {o.order_number} has no line items — nothing to ship, and a total nobody can reconstruct.
                      </p>
                    ) : (
                      lines.map(l => (
                        <div key={l.line_id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                          <span className="font-mono text-white/80">{l.sku}</span>
                          <span className="text-white/40 truncate flex-1 min-w-[6rem]">{l.title}</span>
                          <span className={`font-mono ${l.remaining === 0 ? 'text-white/35' : 'text-white/80'}`}>
                            {l.fulfilled_quantity}/{l.quantity} shipped
                          </span>
                          {l.remaining === 0 ? (
                            <span className="text-[11px] text-white/35">complete</span>
                          ) : (
                            <>
                              <input
                                value={shipQty[l.line_id] ?? ''}
                                onChange={e => setShipQty(q => ({ ...q, [l.line_id]: e.target.value }))}
                                placeholder={`≤ ${l.remaining}`}
                                aria-label={`units of ${l.sku} shipping now (at most ${l.remaining})`}
                                className="w-20 bg-black/40 border border-white/15 rounded-md px-2 py-1 text-xs text-white font-mono"
                              />
                              <button
                                onClick={() => void shipLine(o.order_number, l.line_id)}
                                className="text-[11px] px-2.5 py-1 rounded-md border border-white/20 text-white hover:bg-white/10 transition-colors"
                              >
                                Ship
                              </button>
                            </>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
            {orderActionError && (
              <p role="alert" className="pt-2 text-[11px] text-red-400 leading-snug">
                {orderActionError}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── Catalogue ──────────────────────────────────────────────────── */}
      <Card
        id="commerce-catalogue"
        title={`What is ${projectFilter} selling?`}
        source={productsUrl ?? ''}
        metric={
          products.loaded && products.total !== null
            ? { value: products.total.toLocaleString('en-US'), label: 'active products' }
            : undefined
        }
        empty={
          products.loaded && !products.error && products.total === 0
            ? {
                active: true,
                message:
                  `${projectFilter} has no active products yet. That is the true state of the catalogue, ` +
                  `not a failed load — nothing has been imported or created.`,
              }
            : undefined
        }
      >
        {products.error ? (
          <ApiErrorBanner error={products.error} onRetry={() => window.location.reload()} />
        ) : (
          <div>
            {products.rows.map(pr => (
              <div key={pr.sku} className={ROW}>
                <span className="font-mono text-white/80 truncate">{pr.sku}</span>
                <span className="text-white/50 truncate flex-1 min-w-0">{pr.title}</span>
                <span className="text-white/80 font-mono">{pr.price_display}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Inventory ──────────────────────────────────────────────────── */}
      <Card
        id="commerce-inventory"
        title="What is about to run out?"
        source={
          <>
            {lowUrl}
            <br />
            {levelsUrl}
          </>
        }
        metric={
          low.loaded && low.total !== null
            ? { value: low.total.toLocaleString('en-US'), label: 'at or below reorder point', tone: low.total > 0 ? 'red' : 'default' }
            : undefined
        }
        empty={
          levels.loaded && !levels.error && levels.total === 0
            ? {
                active: true,
                message: `${projectFilter} has no stock records yet — no product has been created to hold stock against.`,
              }
            : undefined
        }
      >
        {levels.error ? (
          <ApiErrorBanner error={levels.error} onRetry={reloadLevels} />
        ) : (
          <div>
            {levels.rows.map(l => (
              <div key={`${l.sku}@${l.location}`}>
                <div className={ROW}>
                  <span className="font-mono text-white/80 truncate">{l.sku}</span>
                  <span className="text-white/40 truncate flex-1 min-w-0">{l.location}</span>
                  <span className={`font-mono ${l.below_reorder ? 'text-red-400' : 'text-white/80'}`}>
                    {l.on_hand} on hand
                    {l.reorder_point > 0 && <span className="text-white/35"> / reorder at {l.reorder_point}</span>}
                  </span>
                  <button
                    onClick={() => {
                      setAdjusting(adjusting === l.sku ? null : l.sku)
                      setAdjustError(null)
                    }}
                    className="shrink-0 text-[11px] px-2 py-0.5 rounded-md border border-white/15 text-white/70 hover:text-white transition-colors"
                  >
                    Adjust
                  </button>
                </div>
                {adjusting === l.sku && (
                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <input
                      value={delta}
                      onChange={e => setDelta(e.target.value)}
                      placeholder="+12 or -4"
                      aria-label={`units to add or remove for ${l.sku}`}
                      className="w-24 bg-black/40 border border-white/15 rounded-md px-2 py-1 text-xs text-white font-mono"
                    />
                    <input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="why (required)"
                      aria-label={`reason for adjusting ${l.sku}`}
                      className="flex-1 min-w-[10rem] bg-black/40 border border-white/15 rounded-md px-2 py-1 text-xs text-white"
                    />
                    <button
                      disabled={busy}
                      onClick={() => void submitAdjustment(l.sku, l.location)}
                      className="text-[11px] px-2.5 py-1 rounded-md border border-white/20 text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
                    >
                      {busy ? 'Saving…' : 'Apply'}
                    </button>
                    {adjustError && (
                      <p role="alert" className="w-full text-[11px] text-red-400 leading-snug">
                        {adjustError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
