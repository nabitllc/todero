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
 *   (Ticket note: this used to be cited as "TOD-2449". Verified against git:
 *   that ticket's actual commit (cc101d5) only touched
 *   scripts/board/channels.json and flight-board.html — unrelated. This
 *   change landed in an unattributed checkpoint commit (5a42434) with no
 *   ticket of its own; not re-cited with another guess.)
 *   Reads take `commerce:read` and writes take `commerce:write` — a
 *   dedicated pair, not borrowed from `projects:*`. It used to be borrowed,
 *   and the reasoning against that is worth keeping: `projects:read`/`write`
 *   answers "can this caller touch this project's records at all", and every
 *   role that could read or write a project's issues could therefore read or
 *   write its storefront too, with no way to grant one without the other.
 *   `lib/rbac-types.ts:ROLE_PERMISSIONS` now grants `commerce:read` /
 *   `commerce:write` to the same roles that held `projects:read` /
 *   `projects:write` (additive — no role's effective access changed), so this
 *   is the seam a future role split (e.g. a bookkeeper who reads commerce but
 *   not issues) hangs off, not yet a behaviour change.
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
  'commerce:read',
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
    // BOTH follow-up writes have their errors checked. Neither used to.
    // "Visible to the inventory surface immediately" (above) was an assertion
    // this code did not keep: if the `inventory_levels` insert failed, the
    // product existed with no stock row at all, and the 201 said so to nobody.
    // A SKU the inventory screen cannot see is not a product an operator can
    // sell, so reporting that state as success is the defect, not the missing
    // row itself.
    if (created) {
      const reorderPoint = validateWholeCount(body.reorder_point, 'reorder_point')
      const { error: levelError } = await db()
        .from('inventory_levels')
        .insert({
          project,
          sku: product.value.sku,
          location: 'default',
          on_hand: 0,
          reorder_point: reorderPoint.ok ? reorderPoint.value : 0,
          updated_at: now,
        })
      if (levelError) {
        return NextResponse.json(
          {
            error: 'inventory_row_write_failed',
            message:
              `"${product.value.sku}" was created as a product but has NO stock row: the ` +
              `inventory_levels write failed (${levelError.message}). The SKU will not appear on ` +
              `the inventory surface and cannot be adjusted or shipped until it does. Re-create ` +
              `the stock row with PATCH /api/commerce/inventory {"sku":"${product.value.sku}",` +
              `"location":"default","on_hand":0,"reason":"..."}, or delete the product and retry.`,
            sku: product.value.sku,
            product_created: true,
            inventory_row_created: false,
          },
          { status: 500 },
        )
      }

      const { error: auditError } = await db().from('commerce_actions').insert({
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
      if (auditError) {
        // The product and its stock row are real and usable; only the audit
        // trail is missing. That is a smaller failure than the one above and
        // gets its own code — but it is still not a 201, because an unaudited
        // write reported as success is how an audit log silently stops being
        // a record of everything that happened.
        return NextResponse.json(
          {
            error: 'audit_write_failed',
            message:
              `"${product.value.sku}" WAS created (with a stock row at 0), but the audit row ` +
              `recording who created it could not be written (${auditError.message}). The product ` +
              `is usable; the commerce_actions log is incomplete for this SKU. Do not retry the ` +
              `create — it will be refused as a duplicate.`,
            sku: product.value.sku,
            product_created: true,
            inventory_row_created: true,
            audited: false,
          },
          { status: 500 },
        )
      }
    }

    // Same rule as the orders POST: a 201 whose body is `product: null` claims
    // a creation nothing can confirm. When `created` is falsy the block above
    // never ran, so there is no stock row and no audit row either — a SKU in
    // none of the three places a product is supposed to exist, reported as
    // created.
    if (!created) {
      return NextResponse.json(
        {
          error: 'product_write_unconfirmed',
          message:
            `"${product.value.sku}" could not be confirmed: the insert reported no error but ` +
            `returned no row. No stock row and no audit row were written. Re-read the catalogue ` +
            `before retrying — a retry will be refused as a duplicate if it did land.`,
          sku: product.value.sku,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ project, product: present(created) }, { status: 201 })
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

    // Audit failure REVERTS the price change, the same way the orders route
    // reverts a status settle whose audit row will not write. A price that
    // moved with no record of who moved it is the one change in this file an
    // operator cannot reconstruct after the fact, and an unchecked insert here
    // meant a 200 that reported the new price as though it had been recorded.
    const { error: auditError } = await db().from('commerce_actions').insert({
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
    if (auditError) {
      const { data: reverted, error: revertError } = await db()
        .from('products')
        .update({
          status: found.status,
          price_minor: found.price_minor,
          currency: found.currency,
          updated_at: new Date().toISOString(),
        })
        .eq('project', project)
        .eq('sku', sku.value)
        .select('*')
      // An error on the revert leaves `data` null, which reads as "did not
      // land" — the pessimistic answer, and the correct direction to fail in.
      const revertLanded = !revertError && ((reverted ?? []) as unknown[]).length > 0
      return NextResponse.json(
        {
          error: revertLanded ? 'audit_write_failed' : 'audit_write_failed_unreconciled',
          message:
            `"${sku.value}" was NOT updated: the audit row could not be written ` +
            `(${auditError.message}). The change (${changes.join('; ')}) ` +
            `${revertLanded ? 'was reverted' : 'could NOT be reverted and needs manual reconciliation — ' +
              `re-read the product and restore ${found.status} @ ` +
              `${formatMinor(found.price_minor, found.currency)} ${found.currency} by hand`}.`,
          sku: sku.value,
          reverted: revertLanded,
        },
        { status: 500 },
      )
    }

    const updated = ((data ?? []) as unknown as ProductRow[])[0] ?? { ...found, ...patch }
    return NextResponse.json({ project, product: present(updated as ProductRow), changed: changes })
  },
)
