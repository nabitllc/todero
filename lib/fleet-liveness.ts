// ─── lib/fleet-liveness.ts — the Fleet surface's liveness vocabulary ─────────
//
// WHY THIS EXISTS, AND WHY IT IS NOT lib/agent-liveness.ts
//
// design/Fleet.dc.html states one rule, in the registration card, in words:
//
//     "Heartbeat every 30s. Offline after 10m of silence."
//
// and the artboard's most-repeated line is the honesty rule made visible:
//
//     "state from hook events, never inferred · last event 4s ago"
//
// The Fleet roster today shows every row reading `never`, and nothing on
// screen says whether that means "no agent has ever checked in" or "we did
// not look". Those are different facts. GET /api/agents collapses them on
// purpose-by-accident:
//
//     liveness = state.livenessSource === 'none' ? 'never' : classifyLiveness(...)
//
// — so a host whose heartbeat store cannot be read at all reports `never` for
// every agent, which is a claim ("no agent has ever checked in") made from an
// absence of evidence ("we could not read the store"). This module refuses to
// make that claim: an unreadable store is `unknown`, and it renders as words
// about the STORE, never as words about the agent.
//
// lib/agent-liveness.ts is left exactly as it is. It answers a narrower
// question for the server — "is this agent answering RIGHT NOW?", with a 60s
// window and a four-value `live | stale | idle | never` vocabulary — and other
// surfaces (AgentDetailView, the office sidebar) render it. This module
// answers the Fleet artboard's question, "is this agent still checking in at
// all?", with the 10-minute window the artboard specifies. The two apply
// DIFFERENT thresholds to the SAME timestamp, so they can word the 60s–10m
// band differently ('stale' there, 'live' here) while never disagreeing about
// a fact. Every string this module produces therefore carries the window it
// used, so the threshold is on screen rather than in a developer's head.
//
// Everything here is pure: `now` is always a parameter, nothing touches the
// DOM, the network, or the database. That is what makes it testable, and the
// tests in lib/__tests__/fleet-liveness.test.ts assert divergence from
// lib/agent-liveness.ts directly, so a regression back to the old behaviour
// fails them.

/**
 * How often the protocol asks an agent to check in. From the artboard's
 * "Heartbeat every 30s" — quoted in the registration card so the operator can
 * see what the number they are looking at is measured against. Nothing here
 * classifies on it; it is the denominator, not the threshold.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * "Offline after 10m of silence." Silence STRICTLY LONGER than this is
 * offline; silence of exactly this length is not yet "after" it. A row whose
 * last heartbeat is inside the window is `live` even though it may have
 * missed several beats — missing a beat is normal, missing twenty is not.
 */
export const OFFLINE_AFTER_MS = 10 * 60_000

/**
 * The four things the Fleet surface can honestly say about one row.
 *
 *   live    — a heartbeat exists and is inside the window
 *   offline — a heartbeat exists and is older than the window
 *   never   — the store was read, and it holds no heartbeat for this agent
 *   unknown — the store could not be read, so NOTHING is known about this
 *             agent's liveness. This is the state the old code did not have,
 *             and its absence is why every row read `never`.
 *
 * `unknown` is not a fifth wheel on a three-state model: the piece's own
 * framing is that "no agent has ever checked in" and "we did not look" are
 * different facts. `never` is the first; `unknown` is the second. Collapsing
 * them is the defect.
 */
export type FleetLiveness = 'live' | 'offline' | 'never' | 'unknown'

/**
 * WHERE a row's `lastSeenAt` came from. GET /api/agents' `lastSeenSource`.
 *
 *   heartbeat    — the heartbeat store answered. This, and only this, is a
 *                  hook event, and only this may be worded as one.
 *   registration — the number is `agent_registrations`' own timestamp. An
 *                  agent that POSTed /api/connect and never checked in again
 *                  has one of these, and it is NOT evidence of a heartbeat.
 *   none         — there is no number at all.
 *
 * This field exists because the roster used to launder the second into the
 * first: lib/agent-registrations.ts read
 * `toEpochMs(row.last_seen_at) ?? registeredAt`, so a row with no recorded
 * check-in inherited its REGISTRATION time, and this module then wrote
 * "heartbeat 4m ago" over a fleet with zero hook events. A timestamp without
 * its provenance cannot be worded honestly, so the provenance travels with it.
 */
export type LivenessProvenance = 'heartbeat' | 'registration' | 'none'

/** The three fields a classification needs, from GET /api/agents' row shape. */
export interface FleetLivenessInput {
  /** Epoch ms of the last recorded heartbeat, or null if the store held none. */
  lastSeenAt: number | null
  /**
   * Whether the heartbeat store could be read at all — GET /api/agents'
   * `livenessSource === 'heartbeat'`. When this is false, `lastSeenAt` is
   * null for every row because nothing was read, NOT because nothing exists,
   * and no liveness claim about the agent may be made from it.
   */
  observed: boolean
  /**
   * Where `lastSeenAt` came from. Required, with no default: a caller that
   * does not know the provenance must say so (`'none'`) rather than have this
   * module assume the flattering answer. See {@link LivenessProvenance}.
   */
  source: LivenessProvenance
}

/**
 * Which of the four states this row is in.
 *
 * A `lastSeenAt` in the future (host clock skew, or a heartbeat written by a
 * machine running ahead) is treated as `live` rather than as an enormous
 * negative age: the agent did check in, and the only wrong thing on screen is
 * the clock. `describeLiveness()` says so in words rather than rendering
 * "heartbeat -3m ago".
 */
export function classifyFleetLiveness(
  input: FleetLivenessInput,
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): FleetLiveness {
  if (!input.observed) return 'unknown'
  // A registration timestamp is not a hook event. This module already refuses
  // to make a claim from an unread store; it refuses to make one from the
  // wrong column for the same reason — the row's own registration time is
  // evidence that the agent EXISTS, never that it checked in.
  if (input.source !== 'heartbeat') return 'never'
  if (input.lastSeenAt === null) return 'never'
  const age = now - input.lastSeenAt
  if (age < 0) return 'live'
  return age <= offlineAfterMs ? 'live' : 'offline'
}

/**
 * A duration as the artboard writes them: "4s", "11s", "15m", "4h 12m".
 * Never negative — a future timestamp is reported by the caller as skew, not
 * as a negative age.
 */
export function formatAge(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000))
  if (t < 60) return `${t}s`
  const minutes = Math.floor(t / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) return remMinutes === 0 ? `${hours}h` : `${hours}h ${remMinutes}m`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`
}

/** One row's state plus the exact words the roster renders for it. */
export interface LivenessDescription {
  state: FleetLiveness
  /** Short badge word — the state itself, so the badge cannot drift from it. */
  badge: FleetLiveness
  /**
   * The full sentence. For `never` and `unknown` this contains NO age,
   * because there is no age to render — that is the whole point of having
   * the two states.
   */
  label: string
}

/**
 * Turn a row into the words the roster shows.
 *
 * `never` and `unknown` are deliberately worded so they cannot be misread as
 * each other: one names the agent ("has never sent a heartbeat"), the other
 * names the store ("the heartbeat store could not be read"). Neither renders
 * a plausible-looking age.
 */
export function describeLiveness(
  input: FleetLivenessInput,
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): LivenessDescription {
  const state = classifyFleetLiveness(input, now, offlineAfterMs)
  const window = formatAge(offlineAfterMs)
  switch (state) {
    case 'live': {
      const age = now - (input.lastSeenAt as number)
      if (age < 0) {
        return {
          state,
          badge: state,
          label: `heartbeat timestamped ${formatAge(-age)} in the future — this host's clock disagrees with the agent's`,
        }
      }
      return { state, badge: state, label: `heartbeat ${formatAge(age)} ago` }
    }
    case 'offline':
      return {
        state,
        badge: state,
        label: `last heartbeat ${formatAge(now - (input.lastSeenAt as number))} ago — offline after ${window} of silence`,
      }
    case 'never': {
      // Three different absences, three different sentences. A row whose only
      // timestamp is its registration has something real to report — WHEN it
      // registered — and reporting that is not the same as reporting a
      // heartbeat, so it may not borrow the heartbeat's words.
      if (input.source === 'registration' && input.lastSeenAt !== null) {
        const age = now - input.lastSeenAt
        const when = age < 0 ? 'in the future by this host’s clock' : `${formatAge(age)} ago`
        return {
          state,
          badge: state,
          label:
            `registered ${when} — that is agent_registrations' own timestamp, not a check-in: ` +
            `no hook event has ever arrived for this agent`,
        }
      }
      return {
        state,
        badge: state,
        label: 'has never sent a heartbeat — the store was read and holds no check-in for this agent',
      }
    }
    case 'unknown':
      return {
        state,
        badge: state,
        label: 'not measured — the heartbeat store could not be read, so nothing is known about this agent',
      }
  }
}

/** Fleet-wide tally. Every field is a count of rows, never an estimate. */
export interface FleetSummary {
  registered: number
  live: number
  offline: number
  never: number
  unknown: number
  /**
   * Newest HOOK EVENT anywhere in the fleet, or null when there is none.
   * Rows whose timestamp came from `agent_registrations` are excluded — see
   * {@link LivenessProvenance}.
   */
  lastEventAt: number | null
  /** True when at least one row's store could be read. */
  anyObserved: boolean
}

export function summarizeFleet(
  rows: readonly FleetLivenessInput[],
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): FleetSummary {
  const summary: FleetSummary = {
    registered: rows.length,
    live: 0,
    offline: 0,
    never: 0,
    unknown: 0,
    lastEventAt: null,
    anyObserved: false,
  }
  for (const row of rows) {
    summary[classifyFleetLiveness(row, now, offlineAfterMs)] += 1
    if (row.observed) summary.anyObserved = true
    // `lastEventAt` is the newest HOOK EVENT, and `fleetProvenanceLine` says
    // so in those words. A registration timestamp is not one, so it may not
    // be the number behind "last event 4m ago".
    if (row.observed && row.source === 'heartbeat' && row.lastSeenAt !== null) {
      summary.lastEventAt =
        summary.lastEventAt === null ? row.lastSeenAt : Math.max(summary.lastEventAt, row.lastSeenAt)
    }
  }
  return summary
}

/**
 * The artboard's provenance line, rendered honestly.
 *
 * design/Fleet.dc.html shows it as "state from hook events, never inferred ·
 * last event 4s ago". The half after the dot is a measurement, so it only
 * exists when there is something to measure:
 *
 *   - a store that could not be read says so, and claims no age;
 *   - a store that was read and holds nothing says NO EVENT HAS EVER ARRIVED,
 *     which is the artboard's honesty rule applied to the artboard's own
 *     line: a fleet with zero events must not render "last event 0s ago".
 */
export function fleetProvenanceLine(
  rows: readonly FleetLivenessInput[],
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): string {
  const summary = summarizeFleet(rows, now, offlineAfterMs)
  const prefix = 'state from hook events, never inferred · '
  if (!summary.anyObserved) {
    return `${prefix}the heartbeat store could not be read, so no event age is known`
  }
  if (summary.lastEventAt === null) {
    return `${prefix}no hook event has ever arrived`
  }
  const age = now - summary.lastEventAt
  if (age < 0) return `${prefix}last event is timestamped ahead of this host's clock`
  return `${prefix}last event ${formatAge(age)} ago`
}

/**
 * The one-line headline the artboard puts beside "Fleet"
 * ("4 registered · 2 live · 1 waiting on you"). Only states with a non-zero
 * count are named, so an operator never reads "0 offline · 0 unknown" and has
 * to decide which zero matters.
 */
export function fleetHeadline(summary: FleetSummary): string {
  const parts = [`${summary.registered} registered`]
  if (summary.live > 0) parts.push(`${summary.live} live`)
  if (summary.offline > 0) parts.push(`${summary.offline} offline`)
  if (summary.never > 0) parts.push(`${summary.never} never checked in`)
  if (summary.unknown > 0) parts.push(`${summary.unknown} not measured`)
  return parts.join(' · ')
}
