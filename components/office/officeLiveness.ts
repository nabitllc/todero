// ─── components/office/officeLiveness.ts — the Office's heartbeat vocabulary ──
//
// WHY THIS FILE EXISTS.
//
// One host was rendering two contradictory answers to "is this agent alive".
//
// GET /api/agents publishes, per row, `lastSeenAt`, `lastSeenSource` and
// `liveness`, and publishes on the envelope `livenessSource:"heartbeat"` and
// `heartbeatStore:"agent_heartbeats"`. CrewTab, FleetRegisterCard and
// useAgentRoster all read those fields and classify them through
// lib/fleet-liveness.ts. The Office read NONE of them: measured 2026-08-26,
// `grep -n "heartbeat|lastSeen|liveness"` over components/office/ returned
// exactly zero matches, and every scrap of agent state on the canvas came
// from `agent_runs` via hooks/useAgentStatus.ts's `runLiveness`.
//
// So at the same moment, on the same server, the Crew tab could say `builder`
// has never sent a heartbeat while the Office drew `builder` at a desk with a
// board task over its head. Both were "true" of their own source and the
// screen never said which question it was answering.
//
// THE RULE THIS MODULE ENFORCES: the two surfaces must agree BY CONSTRUCTION,
// not by two developers keeping two thresholds in step. Everything here
// classifies through `lib/fleet-liveness.ts` — the same module, the same
// 10-minute window, the same four-state vocabulary CrewTab renders. This file
// adds no threshold of its own. What it adds is the Office-shaped question:
// "does the run state I am about to PAINT contradict the heartbeat?", which
// is a question only a surface drawing both can ask.
//
// Everything here is pure. `now` is always a parameter; nothing touches the
// DOM, the network or the database. That is what lets
// __tests__/office-liveness.test.ts execute it instead of grepping it.

import {
  classifyFleetLiveness,
  describeLiveness,
  formatAge,
  OFFLINE_AFTER_MS,
  type FleetLiveness,
  type LivenessProvenance,
} from '@/lib/fleet-liveness'

/** One roster row's heartbeat facts, in the form the canvas paints them. */
export interface OfficeLiveness {
  /** The four-state vocabulary of lib/fleet-liveness.ts. Never widened here. */
  state: FleetLiveness
  /**
   * The exact sentence CrewTab would show for this row — produced by
   * `describeLiveness`, so the Office cannot word the same fact differently.
   * For `never` and `unknown` it contains NO age, by that module's design.
   */
  label: string
  /** Epoch ms of the heartbeat, or null. Null for every non-`live` state. */
  lastSeenAt: number | null
  /** Where `lastSeenAt` came from. `'none'` when there is no timestamp. */
  source: LivenessProvenance
}

/** The whole roster's heartbeat picture, plus what is knowable about it. */
export interface RosterLiveness {
  /** agent id -> that agent's heartbeat facts. */
  byId: Record<string, OfficeLiveness>
  /**
   * Whether the heartbeat store was readable at all — the envelope's
   * `livenessSource === 'heartbeat'`. False means every row is `unknown`,
   * NOT that every agent is silent.
   */
  observed: boolean
  /** How many rows are in each state. Sums to `total`. */
  counts: Record<FleetLiveness, number>
  /** How many roster rows were classified. */
  total: number
}

/** An empty picture — used when the body cannot be read at all. */
function emptyRoster(observed: boolean): RosterLiveness {
  return {
    byId: {},
    observed,
    counts: { live: 0, offline: 0, never: 0, unknown: 0 },
    total: 0,
  }
}

/**
 * Read GET /api/agents' body into per-agent heartbeat facts.
 *
 * The route answers in two shapes and this handles both, the same way
 * OfficeCanvas's roster poll already does: a bare array, or
 * `{ agents: [...], livenessSource, ... }`. Only the enveloped shape can
 * report whether the store was READ, so a bare array is treated as
 * `observed: false` — every row `unknown` — rather than as 28 agents that
 * have never checked in. That is the distinction lib/fleet-liveness.ts exists
 * to preserve, and dropping it here would re-introduce the defect one layer up.
 *
 * A row's `lastSeenSource` is passed through verbatim and NOT defaulted to
 * `'heartbeat'`: a registration timestamp is evidence the agent exists, never
 * evidence that it checked in, and `classifyFleetLiveness` refuses it.
 */
export function livenessFromAgentsBody(body: unknown, now: number = Date.now()): RosterLiveness {
  if (Array.isArray(body)) {
    // No envelope means no `livenessSource`, so nothing is known about the
    // store. Classify every row as `unknown` rather than inventing `never`.
    const out = emptyRoster(false)
    for (const row of body) {
      const r = row as { id?: unknown } | null
      if (typeof r?.id !== 'string' || !r.id) continue
      out.byId[r.id] = describeRow({ lastSeenAt: null, observed: false, source: 'none' }, now)
      out.counts.unknown += 1
      out.total += 1
    }
    return out
  }
  const env = body as { agents?: unknown; livenessSource?: unknown } | null
  if (!env || !Array.isArray(env.agents)) return emptyRoster(false)
  const observed = env.livenessSource === 'heartbeat'
  const out = emptyRoster(observed)
  for (const row of env.agents) {
    const r = row as { id?: unknown; lastSeenAt?: unknown; lastSeenSource?: unknown } | null
    if (typeof r?.id !== 'string' || !r.id) continue
    const lastSeenAt = typeof r.lastSeenAt === 'number' ? r.lastSeenAt : null
    const source: LivenessProvenance =
      r.lastSeenSource === 'heartbeat' || r.lastSeenSource === 'registration' ? r.lastSeenSource : 'none'
    const desc = describeRow({ lastSeenAt, observed, source }, now)
    out.byId[r.id] = desc
    out.counts[desc.state] += 1
    out.total += 1
  }
  return out
}

/** One row -> the four-state classification plus CrewTab's own wording. */
function describeRow(
  input: { lastSeenAt: number | null; observed: boolean; source: LivenessProvenance },
  now: number,
): OfficeLiveness {
  const d = describeLiveness(input, now)
  return {
    state: d.state,
    label: d.label,
    // Only a `live` row has an age worth carrying to the canvas. Carrying a
    // stale timestamp on an `offline`/`never`/`unknown` row is how a plausible
    // number gets painted next to a state that has no number.
    lastSeenAt: d.state === 'live' ? input.lastSeenAt : null,
    source: input.source,
  }
}

/**
 * The compact word painted ON the floor next to an agent.
 *
 * Deliberately NOT a duration for three of the four states. `never` and
 * `unknown` have no age — that is the entire reason lib/fleet-liveness.ts has
 * both — and `offline` has one, but rendering "14h" beside a silent agent
 * reads as activity at a glance. Only `live` gets a number, and it is the age
 * of a real heartbeat row.
 */
export function livenessPip(l: OfficeLiveness | null | undefined, now: number = Date.now()): string {
  if (!l) return '?'
  switch (l.state) {
    case 'live':
      return l.lastSeenAt === null ? 'live' : formatAge(Math.max(0, now - l.lastSeenAt))
    case 'offline':
      return 'offline'
    case 'never':
      return 'no beat'
    case 'unknown':
      return '?'
  }
}

/** The colour each state is painted in. `never` and `unknown` are not green. */
export const LIVENESS_COLOR: Record<FleetLiveness, string> = {
  live: '#00E676',
  offline: '#FF9F43',
  never: '#6a6a8e',
  unknown: '#8E8E9E',
}

/**
 * Does the run-derived state this canvas is about to paint contradict the
 * heartbeat?
 *
 * This is the whole point of wiring liveness into the Office. The canvas
 * decides `working` from `agent_runs`; the Crew tab decides `never` from
 * `agent_heartbeats`. Those are different tables answering different
 * questions, and either may be right. What is NOT acceptable is one host
 * showing both answers and naming neither.
 *
 * `working` is the only run state that makes a positive claim about the agent
 * being alive right now, so it is the only one that can contradict silence.
 * An idle or walking figure claims nothing.
 */
export function livenessContradiction(
  runState: string | null | undefined,
  l: OfficeLiveness | null | undefined,
): string | null {
  if (runState !== 'working') return null
  if (!l) return null
  if (l.state === 'live') return null
  if (l.state === 'unknown') return 'run says working · heartbeat store unreadable'
  if (l.state === 'never') return 'run says working · no heartbeat ever'
  return 'run says working · heartbeat offline'
}

/**
 * The one sentence the Office puts on screen about the floor's heartbeats.
 *
 * Worded from the real counts so it self-corrects: if the store starts
 * answering, the sentence changes on its own. It never renders a plausible
 * number in place of an absent one — an unread store is described as an
 * unread STORE, in words about the store, exactly as lib/fleet-liveness.ts
 * requires.
 */
export function livenessHonestyLine(r: RosterLiveness): string {
  const window = formatAge(OFFLINE_AFTER_MS)
  if (!r.observed) {
    return `⚠ the heartbeat store could not be read — nothing on this floor is evidence any agent is alive`
  }
  if (r.total === 0) {
    return `0 agents on the roster, so there are no heartbeats to report`
  }
  if (r.counts.live === 0) {
    return `0 of ${r.total} agents have sent a heartbeat inside ${window} — every figure below is drawn from agent_runs, not from a live agent`
  }
  return `${r.counts.live} of ${r.total} agents sent a heartbeat inside ${window}`
}

/**
 * Re-export so a caller cannot reach for a second classifier by accident.
 * The Office classifies through lib/fleet-liveness.ts and nothing else.
 */
export { classifyFleetLiveness, OFFLINE_AFTER_MS }
export type { FleetLiveness, LivenessProvenance }
