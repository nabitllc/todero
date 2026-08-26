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

// ─── What is it doing, and is it stuck? ──────────────────────────────────────
//
// Everything above answers "is this agent still checking in". The Fleet
// artboard asks two more questions of the same row — what it is DOING, and
// whether it is STUCK — and the roster answered neither: it rendered a
// liveness badge and a model string and stopped.
//
// The same honesty rule that governs liveness governs both. GET /api/agents'
// `currentTask` is populated from EITHER the agent's own heartbeat OR an
// `issues` row that names it as assignee, and until 2026-08-26 those two very
// different facts arrived as one nullable string. A board ticket is not
// evidence that a process is running — the sibling comment in
// app/api/agents/route.ts has said so since the liveness fix — so wording an
// assigned issue as "working on TOD-123" is the identical fabrication to
// wording a registration timestamp as "heartbeat 4m ago". `currentTaskSource`
// is the fix, and nothing below will call an agent "working" without it.
//
// "Stuck" is likewise never inferred from vibes. There are exactly two things
// this module will call stuck, and each is two measured facts in conjunction:
//   * `blocked`  — the server's own budget verdict says a dispatch would be
//                  refused right now, and carries the reason.
//   * `stalled`  — the agent ITSELF said it was working, and then stopped
//                  checking in for longer than the offline window.
// An agent that never claimed anything is not stuck; it is idle, and it says
// so. An issue that has been open a long time is a fact about the ISSUE, and
// is worded as one.

/**
 * What one row is doing, in five mutually exclusive states.
 *
 *   blocked  — over a budget ceiling: the server would refuse a dispatch now
 *   working  — the agent's own heartbeat named a task, and it is still live
 *   stalled  — the agent's own heartbeat named a task, and it has gone quiet
 *   assigned — the BOARD names it on an issue; no check-in evidence exists
 *   idle     — no task from either source
 *
 * `assigned` is deliberately not called "working". That distinction is the
 * whole point of this vocabulary.
 */
export type FleetActivity = 'blocked' | 'working' | 'stalled' | 'assigned' | 'idle'

/** Where GET /api/agents' `currentTask` came from. Mirrors the route's type. */
export type TaskProvenance = 'heartbeat' | 'assigned-issue' | 'none'

/** The row fields an activity classification reads. All from GET /api/agents. */
export interface FleetActivityInput {
  /** The task string, or null when there is none. */
  currentTask: string | null
  /**
   * Which fact `currentTask` is. Required, with no default, for the same
   * reason {@link FleetLivenessInput.source} is: a caller that does not know
   * must say 'none' rather than have this module assume the flattering
   * answer. A wire type whose server is too old to send it FAILS CLOSED to
   * 'none' at the call site, never to 'heartbeat'.
   */
  currentTaskSource: TaskProvenance
  /** Epoch ms the assigned ISSUE went in progress, or null. A board fact. */
  workStartedAt: number | null
  /** The server's read-only budget verdict, or null when within every ceiling. */
  overCeiling: { ceiling: string; reason: string } | null
  /** This row's liveness, from {@link classifyFleetLiveness}. */
  liveness: FleetLiveness
}

/** One row's activity plus the exact words the roster renders for it. */
export interface ActivityDescription {
  state: FleetActivity
  /** Short badge word — the state itself, so the badge cannot drift from it. */
  badge: FleetActivity
  /** The full sentence, always naming which fact it is built from. */
  label: string
  /**
   * True when this row is one an operator has to do something about. Exactly
   * `blocked` and `stalled` — the two states backed by a measured conjunction.
   * `assigned` is NOT attention-worthy on its own: a ticket with an assignee
   * and no heartbeat is the normal resting state of every board in this repo,
   * and a roster that flagged all 28 rows would be flagging nothing.
   */
  needsAttention: boolean
}

/**
 * Turn a row into the words the roster shows for "what is it doing".
 *
 * Order of precedence is the order of certainty about what an operator must
 * act on: a budget block outranks everything (the agent cannot run at all,
 * whatever it thinks it is doing), then the agent's own claim about itself,
 * then the board's claim about the agent, then nothing.
 */
export function describeActivity(
  input: FleetActivityInput,
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): ActivityDescription {
  const window = formatAge(offlineAfterMs)

  // 1. Blocked. A verdict the server computed against real ledger rows, with
  //    the reason it gave — never this module's paraphrase of it.
  if (input.overCeiling) {
    const reason = input.overCeiling.reason.trim()
    return {
      state: 'blocked',
      badge: 'blocked',
      label:
        `blocked by the ${input.overCeiling.ceiling} ceiling` +
        (reason ? ` — ${reason}` : ' — the server reported no reason text') +
        '. A dispatch would be refused right now.',
      needsAttention: true,
    }
  }

  // 2. The agent's own claim. Only a heartbeat-sourced task reaches here, so
  //    "it says" is literally true.
  if (input.currentTaskSource === 'heartbeat' && input.currentTask) {
    if (input.liveness === 'live') {
      return {
        state: 'working',
        badge: 'working',
        label: `working on "${input.currentTask}" — its own last heartbeat said so`,
        needsAttention: false,
      }
    }
    if (input.liveness === 'offline') {
      return {
        state: 'stalled',
        badge: 'stalled',
        label:
          `said it was working on "${input.currentTask}", then stopped checking in for more than ${window}. ` +
          'Nothing has reported the work finished or failed.',
        needsAttention: true,
      }
    }
    // `never` and `unknown`: there is a task string but no readable liveness
    // to judge it against. Saying "stalled" would be a claim from an absence
    // of evidence — the exact move this file exists to refuse.
    return {
      state: 'assigned',
      badge: 'assigned',
      label:
        `a heartbeat named "${input.currentTask}", but this row's liveness is ${input.liveness}, ` +
        'so whether it is still working cannot be told from here',
      needsAttention: false,
    }
  }

  // 3. The board's claim. Worded as a fact about the ISSUE, because that is
  //    what it is: nobody has shown the agent ever picked it up.
  if (input.currentTaskSource === 'assigned-issue' && input.currentTask) {
    const started =
      input.workStartedAt !== null && now - input.workStartedAt >= 0
        ? ` It has been in progress ${formatAge(now - input.workStartedAt)}.`
        : ''
    return {
      state: 'assigned',
      badge: 'assigned',
      label:
        `${input.currentTask} is assigned to it on the board — that is a board row, not a check-in, ` +
        `and no heartbeat has reported work on it.${started}`,
      needsAttention: false,
    }
  }

  // 4. Nothing from either source. Note this says nothing about liveness: a
  //    live agent with no task is idle and fine; a dead one with no task is
  //    idle and the LIVENESS badge is where that shows.
  return {
    state: 'idle',
    badge: 'idle',
    label: 'no task — neither a heartbeat nor a board row names work for this agent',
    needsAttention: false,
  }
}

/** Fleet-wide activity tally. Every field is a count of rows. */
export interface ActivitySummary {
  blocked: number
  working: number
  stalled: number
  assigned: number
  idle: number
  /** Rows whose `needsAttention` is true — `blocked` + `stalled`. */
  needsAttention: number
}

export function summarizeActivity(
  rows: readonly FleetActivityInput[],
  now: number = Date.now(),
  offlineAfterMs: number = OFFLINE_AFTER_MS,
): ActivitySummary {
  const summary: ActivitySummary = {
    blocked: 0, working: 0, stalled: 0, assigned: 0, idle: 0, needsAttention: 0,
  }
  for (const row of rows) {
    const desc = describeActivity(row, now, offlineAfterMs)
    summary[desc.state] += 1
    if (desc.needsAttention) summary.needsAttention += 1
  }
  return summary
}

/**
 * The second headline line: what the fleet is DOING, beside
 * {@link fleetHeadline}'s what it IS.
 *
 * Same rule as fleetHeadline — only non-zero states are named — with one
 * deliberate exception: a fleet where nothing needs attention SAYS SO, in
 * words, rather than falling silent. Silence is what "nothing is wrong" and
 * "we did not check" look like from the outside, and this whole module exists
 * because those two were indistinguishable on this surface.
 */
export function activityHeadline(summary: ActivitySummary): string {
  const parts: string[] = []
  if (summary.working > 0) parts.push(`${summary.working} working`)
  if (summary.stalled > 0) parts.push(`${summary.stalled} stalled`)
  if (summary.blocked > 0) parts.push(`${summary.blocked} blocked by a budget ceiling`)
  if (summary.assigned > 0) parts.push(`${summary.assigned} assigned on the board, no check-in`)
  if (summary.idle > 0) parts.push(`${summary.idle} idle`)
  const head = parts.length > 0 ? parts.join(' · ') : 'no rows to describe'
  return summary.needsAttention > 0
    ? `${head} — ${summary.needsAttention} need${summary.needsAttention === 1 ? 's' : ''} you`
    : `${head} — nothing is waiting on you`
}

// ─── The one-line form, for surfaces that are not the Fleet roster ───────────
//
// ROUND 2 (2026-08-26). `describeActivity()` above solves "what is it doing"
// properly, but it costs the caller a badge, a tone map and a sentence, and it
// wants a classified `liveness` it must compute first. Exactly ONE surface in
// this repo pays that price — components/tabs/CrewTab.tsx. Five others render
// GET /api/agents' `currentTask` as a bare string, several of them in green
// next to a live dot, which is the flattering guess this whole piece exists to
// stop:
//
//   app/page.tsx:738                    { dot: 'green', label: row.currentTask || … }
//   components/tabs/AgentDetailView.tsx:250, :669
//   components/tabs/AgentsTab.tsx:325   (emerald, gated on dot === 'green')
//   components/tabs/OverviewTab.tsx:262
//   components/tabs/ChatTab.tsx:791     (fed into an LLM roster prompt)
//
// None of those files belongs to this lane, so this round does the half that
// does: it makes the honest string a ONE-TOKEN swap for each of them, and puts
// it on the wire as `AgentDto.currentTaskLabel` so a consumer needs no import
// and no classification step at all. The remaining five diffs are in §8 of
// docs/rebuild/pieces/pieces8/fleet-liveness.md, and they are NOT applied.
//
// WHY THE PROVENANCE WORD COMES FIRST. Every one of those five call sites
// renders inside a `truncate`, which cuts the TAIL. A label reading
// `"TOD-42: fix the nav (board row, not a check-in)"` truncates to
// `"TOD-42: fix the nav…"` — i.e. back to the exact ambiguous string, in the
// exact place it does the most damage. Leading with the provenance means the
// one word a reader is guaranteed to see is the one that says which fact this
// is.

/** The two fields {@link taskLabel} reads. A subset of `FleetActivityInput`. */
export interface TaskLabelInput {
  currentTask: string | null
  currentTaskSource: TaskProvenance
}

/**
 * `currentTask`, worded so it cannot be read as the wrong fact — for any
 * surface that renders one short string and has no room for a sentence.
 *
 *   heartbeat      -> `reported: TOD-42: fix the nav`   (the AGENT's claim)
 *   assigned-issue -> `assigned: TOD-42: fix the nav`   (the BOARD's claim)
 *   none / empty   -> null
 *
 * Returns **null**, not `''` and not a placeholder, when there is no task: the
 * callers all use `label && <span>…` or `label || 'fallback'`, and handing
 * them a truthy empty-ish string would put an empty green line on screen.
 *
 * FAILS CLOSED by construction: an unrecognised or absent provenance takes the
 * `assigned` branch, never the `reported` one, because "the board says so" is
 * the weaker of the two claims and a caller that does not know which it holds
 * must not be upgraded to the agent's own word. (Callers reading a wire type
 * should still coerce a missing field to `'none'` before calling — that is
 * what `CrewTab.activityOf` does — but this function does not depend on it.)
 */
export function taskLabel(input: TaskLabelInput): string | null {
  const task = input.currentTask?.trim()
  if (!task) return null
  return input.currentTaskSource === 'heartbeat' ? `reported: ${task}` : `assigned: ${task}`
}
