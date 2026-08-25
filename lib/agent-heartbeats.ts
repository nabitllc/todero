// ─── Agent liveness: the heartbeat protocol ──────────────────────────────────
//
// Todero used to answer "which agents are running?" by shelling out to the
// host's process table and substring-matching prompt text ("you are builder")
// in the command lines it found. That is not a protocol, it is a guess, and it
// had three failure modes at once: it returned false for every agent whenever
// the spawn command did not happen to contain those words, it could only ever
// see agents on the ONE machine serving the dashboard, and it cost a
// PowerShell interpreter start per poll.
//
// Liveness is now something agents ASSERT and the server RECORDS:
//
//   POST /api/agents/<id>/heartbeat   -> writes { agent_id, last_seen, pid, host, task }
//   GET  /api/agents/<id>/heartbeat   -> that row, or 404 if it never checked in
//   GET  /api/agents                  -> derives every agent's state from those rows
//
// An agent on another host, in a container, or behind a firewall reports its
// own liveness the same way the local one does. An agent that has never
// checked in is reported as exactly that — `never` — rather than as "Idle",
// which is a claim about a running agent that has merely gone quiet.
//
// STORAGE. The real home is the `agent_heartbeats` table
// (migrations/037_agent_heartbeats.sql, applied by `npm run db:migrate`). A host
// that has credentials but has not run migrations — which needs DATABASE_URL,
// separate from the app's own credentials — would otherwise have no liveness at
// all, so the store degrades to an `agent_memory` row per agent: the same table
// and upsert shape `/api/agents/[id]/pause` already uses. The degradation is
// never silent — every read and write reports which store answered and carries
// a warning naming the missing table and the command that creates it.

import { db, isDbConfigured, type DbError } from '@/lib/db'
import { isMissingTableError } from '@/lib/db-http'

/** Dedicated heartbeat table. Created by migrations/037_agent_heartbeats.sql. */
export const HEARTBEAT_TABLE = 'agent_heartbeats'

/** Pre-migration home for the same data. See STORAGE above. */
export const HEARTBEAT_FALLBACK_TABLE = 'agent_memory'

/** `key` used for the fallback rows in `agent_memory`. */
export const HEARTBEAT_FALLBACK_KEY = 'heartbeat'

/** Under this age an agent is answering right now. */
export const LIVE_WINDOW_MS = 60_000

/** Under this age it checked in recently but has missed its last beats. */
export const STALE_WINDOW_MS = 10 * 60_000

/** Which table answered. `null` when neither could be read. */
export type HeartbeatStore = typeof HEARTBEAT_TABLE | typeof HEARTBEAT_FALLBACK_TABLE

/**
 * What the server knows about an agent's liveness.
 *   live   — checked in within LIVE_WINDOW_MS
 *   stale  — checked in within STALE_WINDOW_MS but not recently
 *   idle   — checked in at some point, but not for over STALE_WINDOW_MS
 *   never  — no heartbeat has ever been received for this agent
 */
export type Liveness = 'live' | 'stale' | 'idle' | 'never'

/** One recorded check-in. */
export interface Heartbeat {
  agentId: string
  /** Epoch ms of the check-in. */
  lastSeen: number
  /** Process id the agent reported, when it reported one. */
  pid: number | null
  /** Hostname the agent reported — this is how off-box agents stay visible. */
  host: string | null
  /** What the agent said it was working on. */
  task: string | null
}

/** What an agent sends when it checks in. Only the id is required. */
export interface HeartbeatInput {
  agentId: string
  pid?: number | null
  host?: string | null
  task?: string | null
}

/** Result of a read or a write: the data, the store that served it, and why. */
export interface HeartbeatResult<T> {
  data: T
  /** Table that answered, or null when nothing could be read/written. */
  store: HeartbeatStore | null
  /** Set when the dedicated table is missing, or when the read failed. */
  warning: string | null
  /** Non-null only when a store failed for a reason other than absence. */
  error: DbError | null
}

const MIGRATION_WARNING =
  `Table '${HEARTBEAT_TABLE}' does not exist (run: npm run db:migrate) — ` +
  `heartbeats are being kept in '${HEARTBEAT_FALLBACK_TABLE}' instead.`

/** How old a check-in is allowed to be before it stops meaning "running". */
export function classifyLiveness(lastSeen: number | null, now = Date.now()): Liveness {
  if (lastSeen === null) return 'never'
  const age = now - lastSeen
  if (age < LIVE_WINDOW_MS) return 'live'
  if (age < STALE_WINDOW_MS) return 'stale'
  return 'idle'
}

/** Epoch ms from whatever the column/JSON held, or null if it is unreadable. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const ms = new Date(value).getTime()
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

function toIntOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : null
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** One `agent_heartbeats` row -> `Heartbeat`, or null when it has no timestamp. */
function rowToHeartbeat(row: Record<string, unknown>): Heartbeat | null {
  const agentId = toStringOrNull(row.agent_id)
  const lastSeen = toEpochMs(row.last_seen)
  if (!agentId || lastSeen === null) return null
  return {
    agentId,
    lastSeen,
    pid: toIntOrNull(row.pid),
    host: toStringOrNull(row.host),
    task: toStringOrNull(row.task),
  }
}

/** One `agent_memory` fallback row -> `Heartbeat`. Same fields, JSON-encoded. */
function memoryRowToHeartbeat(row: Record<string, unknown>): Heartbeat | null {
  const agentId = toStringOrNull(row.agent_id)
  if (!agentId) return null
  let parsed: unknown = row.value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  return rowToHeartbeat({ ...(parsed as Record<string, unknown>), agent_id: agentId })
}

function heartbeatToRow(beat: Heartbeat): Record<string, unknown> {
  return {
    agent_id: beat.agentId,
    last_seen: new Date(beat.lastSeen).toISOString(),
    pid: beat.pid,
    host: beat.host,
    task: beat.task,
  }
}

/** Record a check-in. Upserts one row per agent — the latest beat wins. */
export async function recordHeartbeat(input: HeartbeatInput): Promise<HeartbeatResult<Heartbeat | null>> {
  const beat: Heartbeat = {
    agentId: input.agentId,
    lastSeen: Date.now(),
    pid: input.pid ?? null,
    host: input.host ?? null,
    task: input.task ?? null,
  }

  const primary = await db().from(HEARTBEAT_TABLE).upsert(heartbeatToRow(beat), { onConflict: 'agent_id' })
  if (!primary.error) return { data: beat, store: HEARTBEAT_TABLE, warning: null, error: null }
  if (!isMissingTableError(primary.error)) {
    return { data: null, store: null, warning: primary.error.message, error: primary.error }
  }

  // Pre-migration store. The agent id is the row key, so it is not repeated
  // inside the JSON payload.
  const { agent_id: _agentId, ...payload } = heartbeatToRow(beat)
  const fallback = await db()
    .from(HEARTBEAT_FALLBACK_TABLE)
    .upsert(
      { agent_id: beat.agentId, key: HEARTBEAT_FALLBACK_KEY, value: JSON.stringify(payload) },
      { onConflict: 'agent_id,key' },
    )
  if (fallback.error) {
    return { data: null, store: null, warning: fallback.error.message, error: fallback.error }
  }
  return { data: beat, store: HEARTBEAT_FALLBACK_TABLE, warning: MIGRATION_WARNING, error: null }
}

function indexBeats(
  rows: unknown,
  convert: (row: Record<string, unknown>) => Heartbeat | null,
): Map<string, Heartbeat> {
  const out = new Map<string, Heartbeat>()
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const beat = convert(row as Record<string, unknown>)
    if (!beat) continue
    const existing = out.get(beat.agentId)
    if (!existing || beat.lastSeen > existing.lastSeen) out.set(beat.agentId, beat)
  }
  return out
}

/**
 * Every recorded check-in, keyed by agent id. Never throws: a host with no
 * database at all gets an empty map and a warning saying so, because "we
 * cannot tell" must not render as "nobody is running".
 */
export async function readHeartbeats(): Promise<HeartbeatResult<Map<string, Heartbeat>>> {
  const empty = new Map<string, Heartbeat>()
  if (!isDbConfigured()) {
    return { data: empty, store: null, warning: 'database not configured — agent liveness unavailable', error: null }
  }

  try {
    const primary = await db().from(HEARTBEAT_TABLE).select('agent_id,last_seen,pid,host,task')
    if (!primary.error) {
      return { data: indexBeats(primary.data, rowToHeartbeat), store: HEARTBEAT_TABLE, warning: null, error: null }
    }
    if (!isMissingTableError(primary.error)) {
      return { data: empty, store: null, warning: primary.error.message, error: primary.error }
    }

    const fallback = await db()
      .from(HEARTBEAT_FALLBACK_TABLE)
      .select('agent_id,value')
      .eq('key', HEARTBEAT_FALLBACK_KEY)
    if (fallback.error) {
      return { data: empty, store: null, warning: fallback.error.message, error: fallback.error }
    }
    return {
      data: indexBeats(fallback.data, memoryRowToHeartbeat),
      store: HEARTBEAT_FALLBACK_TABLE,
      warning: MIGRATION_WARNING,
      error: null,
    }
  } catch (e) {
    // A thrown DbConfigurationError or transport failure means we could not
    // read liveness — say so rather than reporting every agent as stopped.
    return { data: empty, store: null, warning: e instanceof Error ? e.message : String(e), error: null }
  }
}

/** One agent's check-in, or `null` in `data` when it has never checked in. */
export async function readHeartbeat(agentId: string): Promise<HeartbeatResult<Heartbeat | null>> {
  const all = await readHeartbeats()
  return { ...all, data: all.data.get(agentId) ?? null }
}
