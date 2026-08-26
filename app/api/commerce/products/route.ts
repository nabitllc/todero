/**
 * The catalogue — commerce-operations piece (Wave 7).
 *
 *   GET   /api/commerce/products   -> { project, total, products: [...] }
 *   POST  /api/commerce/products   -> create one product (201)
 *   PATCH /api/commerce/products   -> change a product's price or status
 *
 * WHY CREATE IS PART OF THE FIRST ROUND
 *   The channel goal is objects "you can act on, not a dashboard that only
 *   reports what happened". A catalogue with no create is not just incomplete,
 *   it is unfalsifiable: it can never hold a row, so nobody can tell an empty
 *   storefront from a broken one. This endpoint is what makes the empty state
 *   on CommerceTab an honest statement rather than a permanent one.
 *
 * WHY NO SHOPIFY
 *   Shopify admin is the BENCHMARK this channel names, not a dependency. The
 *   owner has made no decision about a commerce provider, so nothing here makes
 *   an outbound call to a storefront. When a provider is chosen, its importer
 *   writes into these same tables through this same validation.
 *
 * VALIDATION IS ON THE WRITE
 *   Same stance as app/api/hub-settings/route.ts: an unknown key is refused,
 *   not stored. Here that extends to an unknown FIELD — `{"price_usd":"19.99"}`
 *   would otherwise create a product priced 0 while the caller believed they
 *   had set a price. Every refusal below writes nothing.
 *
 * PERMISSIONS
 *   Reads take `projects:read` and writes take `projects:write` — the existing
 *   permission pair whose scope is "this project's own records". A dedicated
 *   `commerce:*` pair would be better, but lib/rbac-types.ts is outside this
 *   piece's ownership and inventing a permission there is a change to the
 *   authorisation model, not a commerce change.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  PRODUCT_CREATE_FIELDS,
  PRODUCT_STATUSES,
  PRODUCT_UPDATE_FIELDS,
  formatMinor,
  normaliseCurrency,
  parseAmountToMinor,
  rejectUnknownFields,
  validateNewProduct,
  validateProductStatus,
  validateSku,
  validateWholeCount,
} from '@/lib/commerce'
import { commerceActor, commerceScope } from '../scope'

interface ProductRow {
  id: string
  project: string
  sku: string
  title: string
  status: string
  price_minor: number
  currency: string
  created_at?: string
  updated_at?: string
}

/** Rows as the UI reads them: the exact integer PLUS a rendered string.
 *  Both, deliberately — the integer is the truth and the string is what a
 *  human reads, and neither is recomputed from the other in the browser. */
function present(row: ProductRow) {
  return {
    id: row.id,
    sku: row.sku,
    title: row.title,
    status: row.status,
    price_minor: row.price_minor,
    currency: row.currency,
    price_display: `${formatMinor(row.price_minor, row.currency)} ${row.currency}`,
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

    const status = req.nextUrl.searchParams.get('status')
    if (status && !(PRODUCT_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: 'bad_status', message: `status must be one of ${PRODUCT_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // `limit` bounds the ROWS returned; `total` is always the exact count of
    // everything matching. The card renders `total`, never `rows.length` —
    // "5 events" from a `limit: 5` page is a live defect elsewhere in this app.
    const limitRaw = req.nextUrl.searchParams.get('limit')
    const limit = limitRaw === null ? 50 : Number(limitRaw)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json(
        { error: 'bad_limit', message: 'limit must be a whole number from 1 to 500' },
        { status: 400 },
      )
    }

    let query = db()
      .from('products')
      .select('*', { count: 'exact' })
      .eq('project', project)
    if (status) query = query.eq('status', status)

    const { data, error, count } = await query.order('sku', { ascending: true }).limit(limit)
    if (error) return dbQueryErrorResponse(error, 'products')

    const rows = (data ?? []) as unknown as ProductRow[]
    return NextResponse.json({
      project,
      total: count ?? rows.length,
      products: rows.map(present),
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

    // Unknown fields answer 400, the same status app/api/hub-settings/route.ts
    // gives an unknown settings key, and separately from the 422 a well-formed
    // body with a bad VALUE gets: "you sent something I do not implement" and
    // "what you sent is not valid" are different problems for the caller.
    // `validateNewProduct` checks this again — it must, because it is the
    // function the tests hold the contract against, and a check that exists
    // only in a route is a check the next caller of the validator does not get.
    const known = rejectUnknownFields(body, PRODUCT_CREATE_FIELDS)
    if (!known.ok) {
      return NextResponse.json({ error: 'unknown_field', message: known.why }, { status: 400 })
    }

    // Everything else is validated BEFORE anything is written. A refused create
    // leaves the products count exactly where it was.
    const product = validateNewProduct(body)
    if (!product.ok) {
      return NextResponse.json({ error: 'invalid_product', message: product.why }, { status: 422 })
    }

    const now = new Date().toISOString()
    const { data, error } = await db()
      .from('products')
      .insert({
        project,
        sku: product.value.sku,
        title: product.value.title,
        status: product.value.status,
        price_minor: product.value.price_minor,
        currency: product.value.currency,
        created_at: now,
        updated_at: now,
      })
      .select('*')

    if (error) {
      // The UNIQUE (project, sku) constraint is the authority on duplicates —
      // not a pre-read, which would race. Translate it into an answer the
      // operator can act on rather than a 500 with a driver string.
      if (/unique|duplicate/i.test(error.message)) {
        return NextResponse.json(
          {
            error: 'duplicate_sku',
            message: `${project} already has a product with sku "${product.value.sku}".`,
          },
          { status: 409 },
        )
      }
      return dbQueryErrorResponse(error, 'products')
    }

    const created = ((data ?? []) as unknown as ProductRow[])[0]

    // An inventory row is created alongside, at zero, so the SKU is visible to
    // the inventory surface immediately. Zero is the TRUE stock of a product
    // just added — this is not a fabricated number, it is the absence of one
    // recorded honestly, and every later change to it goes through the
    // adjust action with a reason.
    if (created) {
      const reorderPoint = validateWholeCount(body.reorder_point, 'reorder_point')
      await db()
        .from('inventory_levels')
        .insert({
          project,
          sku: product.value.sku,
          location: 'default',
          on_hand: 0,
          reorder_point: reorderPoint.ok ? reorderPoint.value : 0,
          updated_at: now,
        })

      await db().from('commerce_actions').insert({
        project,
        action: 'product.create',
        object_type: 'product',
        object_ref: product.value.sku,
        from_value: null,
        to_value: `${product.value.status} @ ${formatMinor(product.value.price_minor, product.value.currency)} ${product.value.currency}`,
        reason: null,
        actor: commerceActor(req),
        created_at: now,
      })
    }

    return NextResponse.json({ project, product: created ? present(created) : null }, { status: 201 })
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

    const scoped = commerceScope(req, 'write', typeof body.project === 'string' ? body.project : null)
    if ('refusal' in scoped) return scoped.refusal
    const { project } = scoped.scope

    const fields = rejectUnknownFields(body, PRODUCT_UPDATE_FIELDS)
    if (!fields.ok) {
      return NextResponse.json({ error: 'unknown_field', message: fields.why }, { status: 400 })
    }

    const sku = validateSku(body.sku)
    if (!sku.ok) return NextResponse.json({ error: 'invalid_sku', message: sku.why }, { status: 422 })

    const { data: found, error: readError } = await db()
      .from('products')
      .select('*')
      .eq('project', project)
      .eq('sku', sku.value)
      .maybeSingle<ProductRow>()
    if (readError) return dbQueryErrorResponse(readError, 'products')
    if (!found) {
      // 404, deliberately, not 403: a scoped caller must not be able to use
      // this endpoint to discover which SKUs exist in another storefront.
      return NextResponse.json(
        { error: 'not_found', message: `${project} has no product with sku "${sku.value}".` },
        { status: 404 },
      )
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const changes: string[] = []

    if (body.currency !== undefined) {
      const currency = normaliseCurrency(String(body.currency))
      if (!currency.ok) {
        return NextResponse.json({ error: 'invalid_currency', message: currency.why }, { status: 422 })
      }
      patch.currency = currency.value
    }
    const currency = String(patch.currency ?? found.currency)

    if (body.price !== undefined && body.price_minor !== undefined) {
      return NextResponse.json(
        { error: 'invalid_price', message: 'pass either price or price_minor, not both — they would disagree' },
        { status: 422 },
      )
    }
    if (body.price !== undefined || body.price_minor !== undefined) {
      const raw = (body.price ?? body.price_minor) as string | number
      const price =
        body.price_minor !== undefined
          ? validateWholeCount(raw, 'price_minor')
          : parseAmountToMinor(raw, currency)
      if (!price.ok) {
        return NextResponse.json({ error: 'invalid_price', message: price.why }, { status: 422 })
      }
      patch.price_minor = price.value
      changes.push(
        `price ${formatMinor(found.price_minor, found.currency)} ${found.currency} -> ${formatMinor(price.value, currency)} ${currency}`,
      )
    }

    if (body.status !== undefined) {
      const status = validateProductStatus(body.status)
      if (!status.ok) {
        return NextResponse.json({ error: 'invalid_status', message: status.why }, { status: 422 })
      }
      if (status.value === found.status) {
        return NextResponse.json(
          {
            error: 'no_change',
            message: `${sku.value} is already ${status.value} — that change would do nothing.`,
          },
          { status: 409 },
        )
      }
      patch.status = status.value
      changes.push(`status ${found.status} -> ${status.value}`)
    }

    if (changes.length === 0) {
      // A green answer for a request that changed nothing is the silent-success
      // shape this repo already ruled against on the approvals path.
      return NextResponse.json(
        { error: 'no_change', message: 'nothing to change — pass price, price_minor, currency or status' },
        { status: 400 },
      )
    }

    const { data, error } = await db()
      .from('products')
      .update(patch)
      .eq('project', project)
      .eq('sku', sku.value)
      .select('*')
    if (error) return dbQueryErrorResponse(error, 'products')

    await db().from('commerce_actions').insert({
      project,
      action: 'product.update',
      object_type: 'product',
      object_ref: sku.value,
      from_value: `${found.status} @ ${formatMinor(found.price_minor, found.currency)} ${found.currency}`,
      to_value: changes.join('; '),
      reason: null,
      actor: commerceActor(req),
      created_at: new Date().toISOString(),
    })

    const updated = ((data ?? []) as unknown as ProductRow[])[0] ?? { ...found, ...patch }
    return NextResponse.json({ project, product: present(updated as ProductRow), changed: changes })
  },
)
