/**
 * connections-discord — per-hub connections.
 *
 *   GET    /api/connections/hub?business_id=<id>  -> { connections: [...], providers: {...} }
 *   POST   /api/connections/hub                   -> add a connection
 *   PATCH  /api/connections/hub                   -> update one (channels, name, credential)
 *   DELETE /api/connections/hub?id=<id>           -> remove one, credential included
 *
 * Modelled on app/api/hub-settings/route.ts, including the part that matters:
 * VALIDATE ON WRITE, and refuse anything unrecognised rather than storing it.
 * Migration 059 stores `config` as TEXT and `custody` as TEXT with no CHECK,
 * because the same rules have to hold on both adapters; this route and
 * lib/connections.ts are the single place both adapters go through.
 *
 * WHY THIS IS A SUBROUTE AND NOT /api/connections
 *   `/api/connections` already exists — a workspace-scoped credential store
 *   from migration 045, with no SQLite twin and no 'discord' in its type CHECK.
 *   Replacing it in place would have changed the response shape a passing
 *   acceptance check reads, on a night four agents are in this tree. It is
 *   left alone and reported instead.
 *
 * THE CREDENTIAL NEVER COMES BACK OUT
 *   Every response here is built by `toPublicConnection()`, whose type has no
 *   field that can hold a credential. The routes do not spread database rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'
import {
  CONNECTIONS_TABLE,
  CONNECTION_SECRETS_TABLE,
  ENCRYPTION_KEY_VAR,
  PROVIDERS,
  PROVIDER_KEYS,
  type ConnectionRow,
  connectionsWithSecrets,
  encryptionAvailable,
  isCustody,
  isProvider,
  newConnectionId,
  parseConfig,
  providerCatalog,
  putSecret,
  toPublicConnection,
  validateConfig,
  validateCredential,
  validateEnvVarName,
} from '@/lib/connections'

/** Every column the public projection needs — and no ciphertext, because it is not in this table. */
const COLUMNS =
  'id,business_id,provider,display_name,config,custody,credential_env_var,credential_hint,credential_set_at,created_at,updated_at'

function bad(why: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: why, ...extra }, { status })
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json()
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** One row by id, or null. Shared by PATCH and DELETE so both agree on shape. */
async function loadRow(id: string): Promise<{ row: ConnectionRow | null; error: string | null }> {
  const { data, error } = await db().from(CONNECTIONS_TABLE).select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return { row: null, error: error.message }
  return { row: (data as unknown as ConnectionRow) ?? null, error: null }
}

// ─── GET ────────────────────────────────────────────────────────────────────

export const GET = withPermission('settings:read', async (req: NextRequest): Promise<NextResponse> => {
  const gate = dbUnavailableResponse()
  if (gate) return gate

  const businessId = req.nextUrl.searchParams.get('business_id')
  if (!businessId) return bad('business_id is required')

  const { data, error } = await db()
    .from(CONNECTIONS_TABLE)
    .select(COLUMNS)
    .eq('business_id', businessId)
    .order('provider', { ascending: true })

  if (error) return dbQueryErrorResponse(error, CONNECTIONS_TABLE)

  const rows = (data ?? []) as unknown as ConnectionRow[]

  // Whether a stored credential EXISTS is measured, not inferred from
  // credential_set_at. A timestamp says a write once happened; only a row says
  // there is something there now. Selects the id column, never the ciphertext.
  const secrets = await connectionsWithSecrets(rows.map((r) => r.id))
  if (secrets.error) {
    return NextResponse.json(
      { error: `could not check credential custody: ${secrets.error}`, table: CONNECTION_SECRETS_TABLE },
      { status: 500 },
    )
  }

  return NextResponse.json({
    connections: rows.map((row) => toPublicConnection(row, secrets.set.has(row.id))),
    providers: providerCatalog(),
    // Said out loud so the card can explain a `stored` write being refused
    // instead of showing a bare error.
    encryption: { available: encryptionAvailable(), env_var: ENCRYPTION_KEY_VAR },
    source: `${CONNECTIONS_TABLE} where business_id = '${businessId}'`,
  })
})

// ─── POST ───────────────────────────────────────────────────────────────────

export const POST = withPermission('settings:write', async (req: NextRequest): Promise<NextResponse> => {
  const gate = dbUnavailableResponse()
  if (gate) return gate

  const body = await readBody(req)
  if (!body) return bad('body must be a JSON object')

  const businessId = typeof body.business_id === 'string' ? body.business_id : ''
  const provider = body.provider
  if (!businessId) return bad('business_id is required')

  // Fail closed. An unknown provider is a typo or an injection, never a feature
  // — the same stance app/api/hub-settings/route.ts takes on an unknown key.
  if (!isProvider(provider)) {
    return bad(`unknown provider "${String(provider)}"`, 400, { known: PROVIDER_KEYS })
  }
  const spec = PROVIDERS[provider]

  const custody = body.custody ?? 'env'
  if (!isCustody(custody)) return bad('custody must be "env" or "stored"', 422)

  const configVerdict = validateConfig(provider, body.config)
  if (!configVerdict.ok) return bad(configVerdict.why, configVerdict.status)

  const displayName =
    typeof body.display_name === 'string' && body.display_name.trim() !== ''
      ? body.display_name.trim()
      : spec.label

  let envVar: string | null = null
  let credential: string | null = null

  if (custody === 'env') {
    // TOD-2429: a `credential` sent alongside custody "env" used to be accepted
    // and silently discarded, and the 201 then reported configured:true with a
    // hint belonging to a DIFFERENT credential — the one in the env var. The
    // caller had every reason to believe their token was stored. PATCH already
    // refuses this exact combination; POST now does too.
    if (body.credential !== undefined && body.credential !== null && body.credential !== '') {
      return bad(
        'a credential cannot be sent with custody "env" — that mode reads a named ' +
          'environment variable and stores nothing. Use custody "stored" to store one.',
        422,
      )
    }
    const verdict = validateEnvVarName(body.credential_env_var ?? spec.defaultEnvVar, spec)
    if (!verdict.ok) return bad(verdict.why, verdict.status)
    envVar = verdict.value
  } else {
    const verdict = validateCredential(provider, body.credential)
    if (!verdict.ok) return bad(verdict.why, verdict.status)
    credential = verdict.value
    // Gate BEFORE writing anything. Without this the connection row would be
    // created and the credential write would then fail, leaving a connection
    // that claims custody it does not have.
    if (!encryptionAvailable()) {
      return NextResponse.json(
        {
          error:
            `${ENCRYPTION_KEY_VAR} is not set, so a credential cannot be stored encrypted. ` +
            `Set it to a 64-character hex string, or use custody "env" instead — there is no plaintext fallback.`,
          missingEnv: [ENCRYPTION_KEY_VAR],
        },
        { status: 503 },
      )
    }
  }

  const id = newConnectionId()
  const now = new Date().toISOString()

  const { data, error } = await db()
    .from(CONNECTIONS_TABLE)
    .insert({
      id,
      business_id: businessId,
      provider,
      display_name: displayName,
      config: JSON.stringify(configVerdict.value),
      custody,
      credential_env_var: envVar,
      credential_hint: null,
      credential_set_at: null,
      created_at: now,
      updated_at: now,
    })
    .select(COLUMNS)
    .single()

  if (error) {
    // The unique index on (business_id, provider) is the constraint talking:
    // one Discord connection per hub, so "which token does this hub post with"
    // has an answer.
    if (/unique|duplicate/i.test(error.message)) {
      return bad(`this hub already has a ${provider} connection — update it instead`, 409)
    }
    return dbQueryErrorResponse(error, CONNECTIONS_TABLE)
  }

  let row = data as unknown as ConnectionRow

  if (credential) {
    const stored = await putSecret(id, credential)
    if (stored.error) {
      // Roll the connection back rather than leave a row promising a
      // credential that is not there.
      await db().from(CONNECTIONS_TABLE).delete().eq('id', id)
      return NextResponse.json({ error: `could not store the credential: ${stored.error}` }, { status: 500 })
    }
    const { data: updated } = await db()
      .from(CONNECTIONS_TABLE)
      .update({ credential_hint: stored.hint, credential_set_at: now, updated_at: now })
      .eq('id', id)
      .select(COLUMNS)
      .single()
    if (updated) row = updated as unknown as ConnectionRow
  }

  return NextResponse.json({ connection: toPublicConnection(row, !!credential) }, { status: 201 })
})

// ─── PATCH ──────────────────────────────────────────────────────────────────

export const PATCH = withPermission('settings:write', async (req: NextRequest): Promise<NextResponse> => {
  const gate = dbUnavailableResponse()
  if (gate) return gate

  const body = await readBody(req)
  if (!body) return bad('body must be a JSON object')

  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return bad('id is required')

  const loaded = await loadRow(id)
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 })
  if (!loaded.row) return bad(`no connection with id "${id}"`, 404)
  const row = loaded.row

  const patch: Record<string, unknown> = {}
  const now = new Date().toISOString()

  if (body.display_name !== undefined) {
    if (typeof body.display_name !== 'string' || body.display_name.trim() === '') {
      return bad('display_name must be a non-empty string', 422)
    }
    patch.display_name = body.display_name.trim()
  }

  if (body.config !== undefined) {
    const verdict = validateConfig(row.provider, body.config)
    // Refused, not merged-and-hoped: a rejected patch must leave the stored
    // config exactly as it was, which is why nothing has been written yet.
    if (!verdict.ok) return bad(verdict.why, verdict.status)
    // A patch replaces the keys it names and keeps the ones it does not, so
    // the card can save one channel without resending the others.
    patch.config = JSON.stringify({ ...parseConfig(row.config), ...verdict.value })
  }

  let custody = row.custody
  if (body.custody !== undefined) {
    if (!isCustody(body.custody)) return bad('custody must be "env" or "stored"', 422)
    custody = body.custody
    patch.custody = custody
  }

  if (body.credential_env_var !== undefined) {
    // TOD-2429: the spec comes from the ROW's provider, not the request, so a
    // caller cannot widen the allowlist by naming a different provider.
    const rowSpec = PROVIDERS[row.provider as keyof typeof PROVIDERS]
    if (!rowSpec) return bad(`connection has unknown provider "${row.provider}"`, 500)
    const verdict = validateEnvVarName(body.credential_env_var, rowSpec)
    if (!verdict.ok) return bad(verdict.why, verdict.status)
    patch.credential_env_var = verdict.value
  }

  let newCredential: string | null = null
  if (body.credential !== undefined && body.credential !== null && body.credential !== '') {
    if (custody !== 'stored') {
      return bad('a credential can only be stored when custody is "stored"', 422)
    }
    const verdict = validateCredential(row.provider, body.credential)
    if (!verdict.ok) return bad(verdict.why, verdict.status)
    if (!encryptionAvailable()) {
      return NextResponse.json(
        {
          error: `${ENCRYPTION_KEY_VAR} is not set, so a credential cannot be stored encrypted. There is no plaintext fallback.`,
          missingEnv: [ENCRYPTION_KEY_VAR],
        },
        { status: 503 },
      )
    }
    newCredential = verdict.value
  }

  if (Object.keys(patch).length === 0 && !newCredential) {
    return bad('nothing to update — send display_name, config, custody, credential_env_var or credential', 422)
  }

  if (newCredential) {
    const stored = await putSecret(id, newCredential)
    if (stored.error) return NextResponse.json({ error: `could not store the credential: ${stored.error}` }, { status: 500 })
    patch.credential_hint = stored.hint
    patch.credential_set_at = now
  }

  patch.updated_at = now

  const { error } = await db().from(CONNECTIONS_TABLE).update(patch).eq('id', id)
  if (error) return dbQueryErrorResponse(error, CONNECTIONS_TABLE)

  const after = await loadRow(id)
  if (after.error || !after.row) {
    return NextResponse.json({ error: after.error ?? 'connection disappeared during update' }, { status: 500 })
  }
  const secrets = await connectionsWithSecrets([id])
  return NextResponse.json({ connection: toPublicConnection(after.row, secrets.set.has(id)) })
})

// ─── DELETE ─────────────────────────────────────────────────────────────────

export const DELETE = withPermission('settings:write', async (req: NextRequest): Promise<NextResponse> => {
  const gate = dbUnavailableResponse()
  if (gate) return gate

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return bad('id query param is required')

  // The credential first, and explicitly. Migration 059 declares ON DELETE
  // CASCADE, but SQLite only honours it with `PRAGMA foreign_keys=ON`, so
  // relying on it would mean orphaned ciphertext on one adapter and not the
  // other. Delete it here and the behaviour is the same everywhere.
  const { error: secretError } = await db().from(CONNECTION_SECRETS_TABLE).delete().eq('connection_id', id)
  if (secretError) {
    return NextResponse.json(
      { error: `could not remove the stored credential, so the connection was left in place: ${secretError.message}` },
      { status: 500 },
    )
  }

  // TOD-2429: this returned `{deleted: id}` for an id that never existed —
  // a status traced to no query. On a credential endpoint, "I removed that
  // credential" is the one answer that must never be given about a row nobody
  // looked for. Confirm it exists first, and 404 when it does not.
  const { data: existing, error: lookupError } = await db()
    .from(CONNECTIONS_TABLE)
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return dbQueryErrorResponse(lookupError, CONNECTIONS_TABLE)
  if (!existing) {
    return NextResponse.json({ error: `no connection with id "${id}"` }, { status: 404 })
  }

  const { error } = await db().from(CONNECTIONS_TABLE).delete().eq('id', id)
  if (error) return dbQueryErrorResponse(error, CONNECTIONS_TABLE)

  return NextResponse.json({ deleted: id })
})
