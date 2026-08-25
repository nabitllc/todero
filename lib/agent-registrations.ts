// ─── Agent registration protocol: the "who exists" half ─────────────────────
//
// lib/agent-heartbeats.ts already answers "is this agent alive right now?".
// This file answers the question one step earlier: "does this agent exist at
// all, and what did it say about itself?" — the POST /api/connect handshake.
//
// The shape is modelled on builderz-labs/mission-control's registration
// protocol (see the comparator analysis this piece was scoped from): a client
// calls POST /api/connect once with { tool_name, agent_name, ... } and the
// SERVER hands back a connection_id plus the URLs to use next
// (heartbeat_url, task_report_url), so the client hardcodes exactly one path
// and discovers the rest. Re-registering is idempotent — it refreshes the row
// rather than erroring, matching builderz's documented behaviour.
//
// STORAGE. The real home is `agent_registrations`
// (migrations/039_agent_registrations.sql). A host that has DB credentials but
// has not run migrations degrades to the SAME `agent_memory` key/value table
// lib/agent-heartbeats.ts already falls back to — one row per agent, keyed
// `registration`, not a table this file invents on its own. The degradation
// is never silent: every read and write reports which store answered.
//
// SERVER ONLY: writes to the database.

import { db, isDbConfigured, type DbError } from '@/lib/db'
import { isMissingTableError } from '@/lib/db-http'

/** Dedicated table. Created by migrations/039_agent_registrations.sql. */
export const REGISTRATIONS_TABLE = 'agent_registrations'

/** Pre-migration home for the same data — see STORAGE above. */
export const REGISTRATIONS_FALLBACK_TABLE = 'agent_memory'

/** `key` used for the fallback rows in `agent_memory`. */
export const REGISTRATIONS_FALLBACK_KEY = 'registration'

/** Which table answered. `null` when neither could be read. */
export type RegistrationStore = typeof REGISTRATIONS_TABLE | typeof REGISTRATIONS_FALLBACK_TABLE

/** One agent's registration record. */
export interface AgentRegistration {
  id: string
  name: string
  runtime: string
  status: string
  capabilities: unknown[]
  connectionId: string | null
  registeredAt: number
  lastSeenAt: number
}

/** What a client sends to POST /api/connect. */
export interface RegisterInput {
  id: string
  name: string
  runtime: string
  capabilities?: unknown[]
  connectionId: string
}

/** Result of a read or a write: the data, the store that served it, and why. */
export interface RegistrationResult<T> {
  data: T
  store: RegistrationStore | null
  warning: string | null
  error: DbError | null
}

const MIGRATION_WARNING =
  `Table '${REGISTRATIONS_TABLE}' does not exist (run: npm run db:migrate) — ` +
  `registrations are being kept in '${REGISTRATIONS_FALLBACK_TABLE}' instead.`

function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function toCapabilities(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** One `agent_registrations` row -> `AgentRegistration`, or null if unreadable. */
function rowToRegistration(row: Record<string, unknown>): AgentRegistration | null {
  const id = toStringOrNull(row.id)
  const registeredAt = toEpochMs(row.registered_at)
  if (!id || registeredAt === null) return null
  return {
    id,
    name: toStringOrNull(row.name) ?? id,
    runtime: toStringOrNull(row.runtime) ?? 'unknown',
    status: toStringOrNull(row.status) ?? 'offline',
    capabilities: toCapabilities(row.capabilities),
    connectionId: toStringOrNull(row.connection_id),
    registeredAt,
    lastSeenAt: toEpochMs(row.last_seen_at) ?? registeredAt,
  }
}

/** One `agent_memory` fallback row -> `AgentRegistration`. Same fields, JSON-encoded. */
function memoryRowToRegistration(row: Record<string, unknown>): AgentRegistration | null {
  const id = toStringOrNull(row.agent_id)
  if (!id) return null
  let parsed: unknown = row.value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  return rowToRegistration({ ...(parsed as Record<string, unknown>), id })
}

function registrationToRow(reg: AgentRegistration): Record<string, unknown> {
  return {
    id: reg.id,
    name: reg.name,
    runtime: reg.runtime,
    status: reg.status,
    capabilities: reg.capabilities,
    connection_id: reg.connectionId,
    registered_at: new Date(reg.registeredAt).toISOString(),
    last_seen_at: new Date(reg.lastSeenAt).toISOString(),
  }
}

/** Shared write path: try the dedicated table, fall back to `agent_memory`. */
async function writeRegistration(reg: AgentRegistration): Promise<RegistrationResult<AgentRegistration | null>> {
  const primary = await db().from(REGISTRATIONS_TABLE).upsert(registrationToRow(reg), { onConflict: 'id' })
  if (!primary.error) return { data: reg, store: REGISTRATIONS_TABLE, warning: null, error: null }
  if (!isMissingTableError(primary.error)) {
    return { data: null, store: null, warning: primary.error.message, error: primary.error }
  }

  // Pre-migration store: same key/value shape lib/agent-heartbeats.ts already
  // uses for its own fallback, and the same table /api/agents (POST/PATCH)
  // already writes capability_registry rows into.
  const { id: _id, ...payload } = registrationToRow(reg)
  const fallback = await db()
    .from(REGISTRATIONS_FALLBACK_TABLE)
    .upsert(
      { agent_id: reg.id, key: REGISTRATIONS_FALLBACK_KEY, value: JSON.stringify(payload) },
      { onConflict: 'agent_id,key' },
    )
  if (fallback.error) {
    return { data: null, store: null, warning: fallback.error.message, error: fallback.error }
  }
  return { data: reg, store: REGISTRATIONS_FALLBACK_TABLE, warning: MIGRATION_WARNING, error: null }
}

/**
 * Register (or re-register) an agent. Upserts one row per agent id — matches
 * builderz's documented behaviour: "re-registering resets status to idle and
 * refreshes timestamps." Here it sets status 'connected' and refreshes both
 * `registered_at` and `last_seen_at` to now, since a fresh POST /api/connect
 * IS the agent asserting "I am here right now."
 */
export async function registerAgent(input: RegisterInput): Promise<RegistrationResult<AgentRegistration | null>> {
  const now = Date.now()
  const reg: AgentRegistration = {
    id: input.id,
    name: input.name,
    runtime: input.runtime,
    status: 'connected',
    capabilities: input.capabilities ?? [],
    connectionId: input.connectionId,
    registeredAt: now,
    lastSeenAt: now,
  }
  return writeRegistration(reg)
}

/**
 * Flip a registered agent's status without touching anything else it
 * reported — used by DELETE /api/connect to mark an agent 'offline' on a
 * clean disconnect, rather than waiting 10 minutes for the heartbeat window
 * to expire. No-op-with-a-reason (`data: null`) when the agent was never
 * registered, since there is nothing to flip.
 */
export async function setRegistrationStatus(
  id: string,
  status: string,
): Promise<RegistrationResult<AgentRegistration | null>> {
  const existing = await readRegistration(id)
  if (!existing.data) {
    return { data: null, store: existing.store, warning: existing.warning ?? `agent '${id}' is not registered`, error: existing.error }
  }
  return writeRegistration({ ...existing.data, status })
}

/**
 * Every registered agent, keyed by id. Never throws: a host with no database
 * at all gets an empty map and a warning saying so.
 */
export async function readRegistrations(): Promise<RegistrationResult<Map<string, AgentRegistration>>> {
  const empty = new Map<string, AgentRegistration>()
  if (!isDbConfigured()) {
    return { data: empty, store: null, warning: 'database not configured — agent registrations unavailable', error: null }
  }

  try {
    const primary = await db().from(REGISTRATIONS_TABLE).select('id,name,runtime,status,capabilities,connection_id,registered_at,last_seen_at')
    if (!primary.error) {
      const out = new Map<string, AgentRegistration>()
      for (const row of Array.isArray(primary.data) ? primary.data : []) {
        const reg = rowToRegistration(row as Record<string, unknown>)
        if (reg) out.set(reg.id, reg)
      }
      return { data: out, store: REGISTRATIONS_TABLE, warning: null, error: null }
    }
    if (!isMissingTableError(primary.error)) {
      return { data: empty, store: null, warning: primary.error.message, error: primary.error }
    }

    const fallback = await db()
      .from(REGISTRATIONS_FALLBACK_TABLE)
      .select('agent_id,value')
      .eq('key', REGISTRATIONS_FALLBACK_KEY)
    if (fallback.error) {
      return { data: empty, store: null, warning: fallback.error.message, error: fallback.error }
    }
    const out = new Map<string, AgentRegistration>()
    for (const row of Array.isArray(fallback.data) ? fallback.data : []) {
      const reg = memoryRowToRegistration(row as Record<string, unknown>)
      if (reg) out.set(reg.id, reg)
    }
    return { data: out, store: REGISTRATIONS_FALLBACK_TABLE, warning: MIGRATION_WARNING, error: null }
  } catch (e) {
    return { data: empty, store: null, warning: e instanceof Error ? e.message : String(e), error: null }
  }
}

/** One agent's registration, or `null` in `data` when it has never connected. */
export async function readRegistration(id: string): Promise<RegistrationResult<AgentRegistration | null>> {
  const all = await readRegistrations()
  return { ...all, data: all.data.get(id) ?? null }
}
