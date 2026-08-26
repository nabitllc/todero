/**
 * connections-discord — per-hub outbound connections and their credentials.
 *
 * FEEDBACK.md item 9: "Discord should be there so something can be added per
 * project ... so the user can add Discord from scratch to a hub."
 *
 * This module is the SERVER half. It owns three things:
 *
 *   1. the provider registry — which providers exist, which config keys each
 *      one declares, and what a valid credential for it looks like;
 *   2. validation, which happens on WRITE. Migration 059 stores `config` as
 *      TEXT and `custody` as TEXT with no CHECK constraint, on purpose: the
 *      same rules have to hold on Postgres and SQLite, and a constraint that
 *      exists on one operator's adapter and not the other's is worse than one
 *      enforced in a single place both adapters go through. That place is here;
 *   3. masking, so no read path can hand out a credential by accident.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It never returns a credential to an HTTP response. `toPublicConnection()`
 *   is the only shape the API is allowed to serialise, and it has no field that
 *   can carry one. `resolveCredential()` exists for server-to-server use (the
 *   Discord POST itself) and is never reachable from a route that echoes it.
 *
 * NOT importable from a client component — it reaches for node crypto and the
 * database seam. `components/tabs/ConnectionsCard.tsx` therefore renders its
 * form from the `providers` catalog the API returns, not from this file, so
 * the form and the validator cannot drift apart.
 */

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/encryption'

export const CONNECTIONS_TABLE = 'hub_connections'
export const CONNECTION_SECRETS_TABLE = 'hub_connection_secrets'

/** The env var lib/encryption.ts needs before it can store anything. */
export const ENCRYPTION_KEY_VAR = 'CONNECTIONS_ENCRYPTION_KEY'

// ─── Custody ────────────────────────────────────────────────────────────────
//
// Two modes, and the row says which. There is no third "plaintext" mode and
// there is deliberately no fallback into one: a column that sometimes holds
// ciphertext and sometimes holds a token is a column nobody can reason about.

export const CUSTODY_MODES = ['env', 'stored'] as const
export type Custody = (typeof CUSTODY_MODES)[number]

export function isCustody(v: unknown): v is Custody {
  return typeof v === 'string' && (CUSTODY_MODES as readonly string[]).includes(v)
}

// ─── Provider registry ──────────────────────────────────────────────────────

export interface ProviderSpec {
  /** Human label for the card's heading. */
  label: string
  /**
   * The ONLY config keys this provider accepts. Anything else is refused, not
   * stored — the same fail-closed stance app/api/hub-settings/route.ts takes
   * for an unknown setting key, and for the same reason: an open write to a
   * table the app reads back and trusts is an open write to the app.
   */
  configKeys: readonly { key: string; label: string; hint: string }[]
  /** Env var an `env`-custody connection defaults to. */
  defaultEnvVar: string
  /** Prose for the UI describing the credential's expected shape. */
  credentialShape: string
  /** True when `raw` has the provider's credential shape. */
  validateCredential(raw: string): boolean
  /** True when `value` is a plausible value for one of `configKeys`. */
  validateConfigValue(key: string, value: string): boolean
}

/**
 * A Discord snowflake: 17-20 digits. Channel ids are snowflakes, so a config
 * value that is not one is a typo the operator should see immediately rather
 * than discover when a notification silently 404s.
 */
const SNOWFLAKE = /^\d{17,20}$/

/**
 * Discord bot token shape: three base64url segments. The first encodes the
 * application id, the second a timestamp, the third an HMAC. Matching the
 * SHAPE rather than a specific value is what lets this be checked without ever
 * knowing what the operator's token is.
 *
 * Anchored here because this validates ONE candidate string. The near-identical
 * rule in scripts/check-no-secrets.js is deliberately unanchored — it is
 * looking for the shape embedded anywhere in a line of source.
 */
const DISCORD_TOKEN_SHAPE = /^[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}$/

export const PROVIDERS: Record<string, ProviderSpec> = {
  discord: {
    label: 'Discord',
    defaultEnvVar: 'DISCORD_BOT' + '_TOKEN',
    credentialShape: 'A bot token: three dot-separated segments, e.g. 25 chars · 6 chars · 38 chars.',
    configKeys: [
      { key: 'completed_tasks_channel', label: 'Completed tasks', hint: 'Channel id notified when an issue closes' },
      { key: 'alerts_channel', label: 'Alerts', hint: 'Channel id for escalations and failed reviews' },
      { key: 'created_channel', label: 'Created', hint: 'Channel id notified when an issue is created' },
      { key: 'queue_channel', label: 'Queue', hint: 'Channel id for rejection-loop notices' },
    ],
    validateCredential: (raw) => DISCORD_TOKEN_SHAPE.test(raw),
    validateConfigValue: (_key, value) => SNOWFLAKE.test(value),
  },
}

export const PROVIDER_KEYS = Object.keys(PROVIDERS)

export function isProvider(v: unknown): v is string {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, v)
}

// ─── Masking ────────────────────────────────────────────────────────────────

/** How many trailing characters a hint may reveal. */
export const HINT_TAIL = 6

/**
 * `••••` plus the last six characters — enough for an operator to tell which
 * token is installed, not enough to be one.
 *
 * A short value reveals NOTHING. Six of eight characters is not a hint, it is
 * the secret with a hat on, and the caller has no way to know how long the
 * value was.
 */
export function maskSecret(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.length < HINT_TAIL * 3) return '••••'
  return '••••' + raw.slice(-HINT_TAIL)
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** A row of `hub_connections` exactly as migration 059 defines it. */
export interface ConnectionRow {
  id: string
  business_id: string
  provider: string
  display_name: string
  /** JSON text. See the migration for why this is TEXT and not JSONB. */
  config: string | Record<string, string> | null
  custody: string
  credential_env_var: string | null
  credential_hint: string | null
  credential_set_at: string | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * The ONLY shape the API may serialise. There is no field on it that can
 * carry a credential — that is the point, and it is why routes return this
 * rather than spreading a row.
 */
export interface PublicConnection {
  id: string
  business_id: string
  provider: string
  display_name: string
  config: Record<string, string>
  custody: Custody | string
  credential_env_var: string | null
  /** `••••` + last 6, or null when nothing is installed. Never the value. */
  credential_hint: string | null
  /**
   * Whether this connection can actually produce a credential RIGHT NOW, in
   * this process. Measured, never assumed: an `env` connection whose variable
   * is unset is `false`, and a `stored` one is `false` when the encryption key
   * is missing, because the ciphertext cannot be read without it.
   */
  configured: boolean
  /** Why `configured` is false. Null when it is true. */
  unconfigured_reason: string | null
  credential_set_at: string | null
  updated_at: string | null
}

/**
 * Read `config` back tolerantly. The column is TEXT holding JSON on SQLite and
 * may arrive already parsed from another adapter, so both are accepted; a value
 * that is neither yields `{}` rather than throwing a route into a 500.
 * Non-string members are dropped — a config is a map of ids, not a bag.
 */
export function parseConfig(raw: unknown): Record<string, string> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

// ─── Validation, on write ───────────────────────────────────────────────────

export type Verdict<T> = { ok: true; value: T } | { ok: false; why: string; status: number }

/**
 * Validate a config object against its provider's declared keys.
 *
 * An unknown key is REFUSED, not dropped and not stored. Dropping it silently
 * would mean the operator's typo disappears and the notification never arrives,
 * with nothing on screen to say why.
 */
export function validateConfig(provider: string, raw: unknown): Verdict<Record<string, string>> {
  const spec = PROVIDERS[provider]
  if (!spec) {
    return { ok: false, why: `unknown provider "${provider}"`, status: 400 }
  }
  if (raw === undefined || raw === null) return { ok: true, value: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, why: 'config must be a JSON object of channel ids', status: 422 }
  }
  const known = new Set(spec.configKeys.map((c) => c.key))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(key)) {
      return {
        ok: false,
        why: `unknown config key "${key}" for ${provider}. Accepted: ${[...known].join(', ')}`,
        status: 422,
      }
    }
    if (typeof value !== 'string') {
      return { ok: false, why: `config value for "${key}" must be a string`, status: 422 }
    }
    // An empty string is how the UI clears a channel — that is a removal, not
    // a malformed id, so it is allowed through and stored as absent.
    if (value === '') continue
    if (!spec.validateConfigValue(key, value)) {
      return {
        ok: false,
        why: `config value for "${key}" is not a valid ${provider} channel id`,
        status: 422,
      }
    }
    out[key] = value
  }
  return { ok: true, value: out }
}

/** Validate a credential's SHAPE. Never its authenticity — that is the test endpoint's job. */
export function validateCredential(provider: string, raw: unknown): Verdict<string> {
  const spec = PROVIDERS[provider]
  if (!spec) return { ok: false, why: `unknown provider "${provider}"`, status: 400 }
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, why: 'credential must be a non-empty string', status: 422 }
  }
  const value = raw.trim()
  if (!spec.validateCredential(value)) {
    return { ok: false, why: `that does not look like a ${spec.label} credential. ${spec.credentialShape}`, status: 422 }
  }
  return { ok: true, value }
}

/**
 * An env var name, validated so it cannot be used to reach arbitrary process
 * state through a shell-ish string. Uppercase, digits and underscores only.
 */
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]{2,63}$/

export function validateEnvVarName(raw: unknown): Verdict<string> {
  if (typeof raw !== 'string' || !ENV_VAR_NAME.test(raw)) {
    return { ok: false, why: 'credential_env_var must be an UPPER_SNAKE_CASE environment variable name', status: 422 }
  }
  return { ok: true, value: raw }
}

// ─── Encryption availability ────────────────────────────────────────────────

/**
 * Whether lib/encryption.ts can work in this process. Checked BEFORE a write
 * rather than caught after, so a `stored` write fails closed with the variable
 * name in the body instead of a 500 with the reason only in the server log.
 */
export function encryptionAvailable(): boolean {
  const hex = process.env[ENCRYPTION_KEY_VAR]
  return typeof hex === 'string' && hex.length === 64
}

// ─── Projection ─────────────────────────────────────────────────────────────

/**
 * Turn a row into the only shape the API may return.
 *
 * `hasStoredSecret` is MEASURED by the caller (a `select('connection_id')` on
 * hub_connection_secrets — the id column, never the ciphertext), not read off
 * `credential_set_at`. A timestamp says a write once happened; it does not say
 * a credential is there now.
 */
export function toPublicConnection(row: ConnectionRow, hasStoredSecret: boolean): PublicConnection {
  const base = {
    id: row.id,
    business_id: row.business_id,
    provider: row.provider,
    display_name: row.display_name,
    config: parseConfig(row.config),
    custody: row.custody,
    credential_env_var: row.credential_env_var,
    credential_set_at: row.credential_set_at ?? null,
    updated_at: row.updated_at ?? null,
  }

  if (row.custody === 'env') {
    const name = row.credential_env_var
    if (!name) {
      return { ...base, credential_hint: null, configured: false, unconfigured_reason: 'custody is "env" but no environment variable is named on this connection' }
    }
    const value = process.env[name]
    if (!value) {
      return { ...base, credential_hint: null, configured: false, unconfigured_reason: `${name} is not set in the server process` }
    }
    // The hint is derived from the LIVE value, so it cannot claim a credential
    // that is no longer there.
    return { ...base, credential_hint: maskSecret(value), configured: true, unconfigured_reason: null }
  }

  if (row.custody === 'stored') {
    if (!hasStoredSecret) {
      return { ...base, credential_hint: null, configured: false, unconfigured_reason: 'no credential has been stored for this connection yet' }
    }
    if (!encryptionAvailable()) {
      return {
        ...base,
        credential_hint: row.credential_hint,
        configured: false,
        unconfigured_reason: `${ENCRYPTION_KEY_VAR} is not set in this process, so the stored credential cannot be read`,
      }
    }
    return { ...base, credential_hint: row.credential_hint, configured: true, unconfigured_reason: null }
  }

  return { ...base, credential_hint: null, configured: false, unconfigured_reason: `unrecognised custody "${row.custody}"` }
}

/** The provider catalog the card renders its form from. Contains no secrets. */
export function providerCatalog() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([key, spec]) => [
      key,
      {
        label: spec.label,
        defaultEnvVar: spec.defaultEnvVar,
        credentialShape: spec.credentialShape,
        configKeys: spec.configKeys,
      },
    ]),
  )
}

// ─── Persistence ────────────────────────────────────────────────────────────

export interface WriteInput {
  businessId: string
  provider: string
  displayName: string
  config: Record<string, string>
  custody: Custody
  envVar: string | null
  /** Plaintext, custody='stored' only. Never persisted as given. */
  credential: string | null
}

export function newConnectionId(): string {
  return randomUUID()
}

/**
 * Store (or replace) a credential's ciphertext. Returns the hint to record on
 * the connection row.
 *
 * Throws when the encryption key is absent — callers must gate on
 * `encryptionAvailable()` first so the operator gets the variable name rather
 * than a 500. There is no plaintext path out of this function.
 */
export async function putSecret(connectionId: string, plaintext: string): Promise<{ hint: string | null; error: string | null }> {
  if (!encryptionAvailable()) {
    return { hint: null, error: `${ENCRYPTION_KEY_VAR} is not set` }
  }
  const ciphertext = encrypt(plaintext)
  const { error } = await db()
    .from(CONNECTION_SECRETS_TABLE)
    .upsert(
      { connection_id: connectionId, ciphertext, algorithm: 'aes-256-gcm', updated_at: new Date().toISOString() },
      { onConflict: 'connection_id' },
    )
  if (error) return { hint: null, error: error.message }
  return { hint: maskSecret(plaintext), error: null }
}

/** Which of these connection ids have a stored credential. Selects the id column only. */
export async function connectionsWithSecrets(ids: readonly string[]): Promise<{ set: Set<string>; error: string | null }> {
  if (ids.length === 0) return { set: new Set(), error: null }
  const { data, error } = await db()
    .from(CONNECTION_SECRETS_TABLE)
    .select('connection_id')
    .in('connection_id', ids as string[])
  if (error) return { set: new Set(), error: error.message }
  const rows = (data ?? []) as { connection_id: string }[]
  return { set: new Set(rows.map((r) => r.connection_id)), error: null }
}

/**
 * The credential for one connection, for server-to-server use only.
 *
 * Returns `null` rather than a placeholder when nothing is available. A caller
 * that receives null must SKIP the send and say why — never post with an empty
 * Authorization header and let Discord's 401 be the only record.
 */
export async function resolveCredential(row: ConnectionRow): Promise<string | null> {
  if (row.custody === 'env') {
    const name = row.credential_env_var
    return name ? (process.env[name] ?? null) : null
  }
  if (row.custody !== 'stored' || !encryptionAvailable()) return null
  const { data, error } = await db()
    .from(CONNECTION_SECRETS_TABLE)
    .select('ciphertext')
    .eq('connection_id', row.id)
    .maybeSingle()
  if (error || !data) return null
  try {
    return decrypt((data as { ciphertext: string }).ciphertext)
  } catch {
    return null
  }
}

/**
 * The Discord connection for a hub, resolved to a usable token and channel map.
 *
 * This is the function `app/api/issues/route.ts` cuts over to. It returns null
 * — never a fallback constant — when the hub has no connection and
 * DISCORD_BOT_TOKEN is unset, so "no credential" is a state the caller must
 * handle rather than a silent post as somebody else's bot.
 */
export async function resolveHubDiscord(
  businessId: string | null | undefined,
): Promise<{ token: string; channels: Record<string, string>; source: string } | null> {
  if (businessId) {
    const { data, error } = await db()
      .from(CONNECTIONS_TABLE)
      .select('id,business_id,provider,display_name,config,custody,credential_env_var,credential_hint,credential_set_at,updated_at')
      .eq('business_id', businessId)
      .eq('provider', 'discord')
      .maybeSingle()
    if (!error && data) {
      const row = data as unknown as ConnectionRow
      const token = await resolveCredential(row)
      if (token) {
        return { token, channels: parseConfig(row.config), source: `${CONNECTIONS_TABLE}(${row.id}) custody=${row.custody}` }
      }
    }
  }
  // Process-wide fallback, for a deployment that has not created a connection
  // yet. This is an environment variable, not a literal — a fresh clone with no
  // .env.local resolves to null here and posts nothing.
  const fromEnv = process.env[PROVIDERS.discord.defaultEnvVar]
  if (fromEnv) {
    return { token: fromEnv, channels: {}, source: `process.env.${PROVIDERS.discord.defaultEnvVar}` }
  }
  return null
}
