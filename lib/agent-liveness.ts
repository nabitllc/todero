// ─── Shared liveness classification ──────────────────────────────────────────
//
// Pulled out of lib/agent-heartbeats.ts so lib/agent-registrations.ts can
// classify a `last_seen_at` column the exact same way without importing
// agent-heartbeats.ts — which now imports agent-registrations.ts itself (to
// bump `agent_registrations.last_seen_at` on every recorded heartbeat; see
// recordHeartbeat()). Importing back the other way would be a circular
// dependency between the two modules. This file has no dependents of its own,
// so both can import it safely.
//
// Re-exported from lib/agent-heartbeats.ts so every existing
// `from '@/lib/agent-heartbeats'` import of these names keeps working
// unchanged.

/** Under this age an agent is answering right now. */
export const LIVE_WINDOW_MS = 60_000

/** Under this age it checked in recently but has missed its last beats. */
export const STALE_WINDOW_MS = 10 * 60_000

/**
 * What the server knows about an agent's liveness.
 *   live   — checked in within LIVE_WINDOW_MS
 *   stale  — checked in within STALE_WINDOW_MS but not recently
 *   idle   — checked in at some point, but not for over STALE_WINDOW_MS
 *   never  — no heartbeat has ever been received for this agent
 */
export type Liveness = 'live' | 'stale' | 'idle' | 'never'

/** How old a check-in is allowed to be before it stops meaning "running". */
export function classifyLiveness(lastSeen: number | null, now = Date.now()): Liveness {
  if (lastSeen === null) return 'never'
  const age = now - lastSeen
  if (age < LIVE_WINDOW_MS) return 'live'
  if (age < STALE_WINDOW_MS) return 'stale'
  return 'idle'
}
