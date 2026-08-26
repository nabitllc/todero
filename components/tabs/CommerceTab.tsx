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
  const productsUrl = p ? `/api/commerce/products?project=${p}&status=active&limit=10` : null
  const levelsUrl = p ? `/api/commerce/inventory?project=${p}&limit=25` : null
  const lowUrl = p ? `/api/commerce/inventory?project=${p}&below_reorder=1&limit=1` : null

  const [orders, reloadOrders] = useEndpoint<OrderView>(ordersUrl, b => ((b as { orders?: OrderView[] }).orders ?? []))
  const [products] = useEndpoint<ProductView>(productsUrl, b => ((b as { products?: ProductView[] }).products ?? []))
  const [levels, reloadLevels] = useEndpoint<LevelView>(levelsUrl, b => ((b as { levels?: LevelView[] }).levels ?? []))
  const [low, reloadLow] = useEndpoint<LevelView>(lowUrl, b => ((b as { levels?: LevelView[] }).levels ?? []))

  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // TOD-2449: `advance()` used to ignore the PATCH response entirely — a
  // refused transition (permission denied, illegal state, a 500) reloaded the
  // same unfulfilled list and looked, to the operator, exactly like a
  // successful click that happened to do nothing. `orderActionError` is the
  // same surfaced-refusal pattern `adjustError` already uses below.
  const [orderActionError, setOrderActionError] = useState<string | null>(null)

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
        return
      }
      reloadOrders()
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
        source={ordersUrl ?? ''}
        metric={
          orders.loaded && orders.total !== null
            ? { value: orders.total.toLocaleString('en-US'), label: 'unfulfilled', tone: orders.total > 0 ? 'amber' : 'default' }
            : undefined
        }
        empty={
          orders.loaded && !orders.error && orders.total === 0
            ? { active: true, message: `${projectFilter} has no unfulfilled orders. Nothing is waiting to ship.` }
            : undefined
        }
      >
        {orders.error ? (
          <ApiErrorBanner error={orders.error} onRetry={reloadOrders} />
        ) : (
          <div>
            {orders.rows.map(o => (
              <div key={o.order_number} className={ROW}>
                <span className="font-mono text-white/80 truncate">{o.order_number}</span>
                <span className="text-white/50 truncate flex-1 min-w-0">{o.customer_email ?? '—'}</span>
                <span className="text-white/80 font-mono">{o.total_display}</span>
                <button
                  onClick={() => void advance(o.order_number, 'fulfilled')}
                  className="shrink-0 text-[11px] px-2 py-0.5 rounded-md border border-white/15 text-white/70 hover:text-white transition-colors"
                >
                  Mark fulfilled
                </button>
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
