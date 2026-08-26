// ─── components/office/officeWiring.ts — the effect bodies, made executable ───
//
// WHY THIS FILE EXISTS.
//
// officePolling.ts lifted the DECISIONS out of OfficeCanvas's useEffects. It
// did not lift the WIRING — the lines that take a decision and apply it to a
// ref, a banner and the feed. Those stayed inside a .tsx component that no
// test in this repo can mount (jest.config.js is `testEnvironment: "node"`,
// and neither jsdom nor @testing-library is installed — verified 2026-08-26 by
// `ls node_modules/jest-environment-jsdom` and `ls node_modules/jsdom`, both
// absent).
//
// A fresh-context critic measured what that cost. Thirty mutations, nine
// survived a fully green suite, and SEVEN of the nine were inside
// OfficeCanvas.tsx:
//
//   • `partitionWaiting(out.waiting, roster)` -> `(out.waiting, [])`
//     — every waiting agent classified off-roster, no bubble can ever render.
//   • delete `setPollError('waiting', out.error)` — a failed /api/inbox draws
//     a silent, confident "nobody is waiting" with no banner.
//   • delete `setPollError('tasks', out.error)` — same, for /api/issues.
//   • `boardTasks:boardTasksRef.current` -> `{}` — every desk loses its label.
//   • `runs:liveRunsRef.current` -> `{}` — every cost and clock disappears.
//   • `subagentCount:subagentCountRef.current` -> `99` — a fabricated number
//     painted on the orchestrator's head.
//   • `selectedId` -> `null` — see the note on `OfficeDrawRefs.selectedIdRef`;
//     this one turned out not to be a coverage hole at all.
//
// officePolling.ts's header claimed at the time that "the residual seam is one
// named argument instead of a whole feature". That was false of the shipped
// code and is corrected there now. This file is the actual repair: every one
// of those seven lines is moved into a pure exported function below, so
// breaking it fails a test that RAN it rather than a test that read it.
//
// WHAT IS STILL NOT COVERED, stated plainly rather than implied: the single
// expression in each useEffect that hands these functions the ref objects.
// That is roughly one line per effect, it is enumerated in
// docs/rebuild/pieces/pieces9/agent-visualization.md §6, and most of it is a
// `tsc` error to get wrong because the ref types differ from one another
// (`Record<string,string>` vs `Record<string,number>` vs `number`). Mounting
// the component is what would close the rest, and that needs a package.json
// change this lane does not own — the exact diff is §9 of the piece doc.

import type { ApiError } from '@/lib/fetch-json'
import type { AgentRunInfo } from './officeConstants'
import type { DrawAgentsOptions } from './officeDrawing'
import { partitionWaiting, unroutedWaitingMessage } from './officePolling'
import { livenessFromAgentsBody, type RosterLiveness } from './officeLiveness'

/**
 * A React ref, structurally. Typed as `{ current: T }` rather than importing
 * `MutableRefObject` so a test can pass a plain object and still be exercising
 * the real function — no React, no renderer, no mock.
 */
export interface Cell<T> { current: T }

/** The two sinks these functions write to besides the refs. */
export type SetPollError = (key: string, err: ApiError | null) => void
export type AddFeed = (text: string, color?: string) => void

// ─── Board tasks ─────────────────────────────────────────────────────────────

/**
 * Apply one board-task poll result.
 *
 * BOTH halves happen here, always, and that is the point: the banner is raised
 * from the SAME call that decides whether to touch the map. Deleting the
 * banner is no longer deleting a line next to another line; it is changing a
 * function whose test asserts the pair.
 *
 * `tasks === null` means the answer was unreadable, so the previous board is
 * kept rather than emptying every desk — an unreadable answer is not evidence
 * of an empty board, and the banner says which it was.
 */
export function applyBoardTaskOutcome(
  out: { tasks: Record<string, string> | null; error: ApiError | null },
  boardTasksRef: Cell<Record<string, string>>,
  setPollError: SetPollError,
): void {
  setPollError('tasks', out.error)
  if (out.tasks) boardTasksRef.current = out.tasks
}

// ─── Waiting on you ──────────────────────────────────────────────────────────

/**
 * The roster of ids the CANVAS can actually draw a bubble over.
 *
 * Extracted for one reason: the critic's surviving mutation was replacing this
 * value with `[]` at the call site, which classifies every pending row as
 * off-roster and kills the bubble outright while leaving the feed line
 * shouting about it. Inside a function, that mutation fails
 * `__tests__/office-wiring.test.ts`'s "a pending row for an agent ON the floor
 * is drawable".
 *
 * It reads the SIMULATION's agents, not /api/agents' roster, and deliberately:
 * a bubble is painted over a figure on the floor, so "can I draw this" is a
 * question about the figures, not about the register.
 */
export function rosterIdsFromSim(sim: { agents?: unknown } | null | undefined): string[] {
  const agents = sim?.agents
  if (!Array.isArray(agents)) return []
  const ids: string[] = []
  for (const a of agents) {
    const id = (a as { id?: unknown } | null)?.id
    if (typeof id === 'string' && id) ids.push(id)
  }
  return ids
}

/** What one "waiting on you" poll did, returned so a test can assert all of it. */
export interface WaitingApplied {
  /** The counts that will actually be painted, keyed by a figure on the floor. */
  drawable: Record<string, number>
  /** Pending rows naming agents this canvas cannot draw. */
  unroutedIds: string[]
  unroutedRows: number
  /** The feed sentence, or null when there was nothing new to say. */
  message: string | null
}

/**
 * Apply one "waiting on you" poll result: the banner, the bubbles, and the
 * unrouted feed line, from one call.
 *
 * The de-duplication of the feed line lives here too (`lastMsgRef`), because a
 * 60s poll that keeps finding the same off-roster agent must say it once, not
 * once a minute — and a mutation that drops the de-dupe is now a test failure
 * rather than a line nobody enumerated.
 */
export function applyWaitingOutcome(
  out: { waiting: Record<string, number>; error: ApiError | null },
  sim: { agents?: unknown } | null | undefined,
  waitingRef: Cell<Record<string, number>>,
  lastMsgRef: Cell<string | null>,
  setPollError: SetPollError,
  addFeed: AddFeed,
): WaitingApplied {
  setPollError('waiting', out.error)
  const split = partitionWaiting(out.waiting, rosterIdsFromSim(sim))
  waitingRef.current = split.drawable
  const message = unroutedWaitingMessage(split.unroutedIds, split.unroutedRows)
  if (message && message !== lastMsgRef.current) addFeed(message, '#E879F9')
  lastMsgRef.current = message
  return { drawable: split.drawable, unroutedIds: split.unroutedIds, unroutedRows: split.unroutedRows, message }
}

// ─── Roster + heartbeat liveness ─────────────────────────────────────────────

/** What one /api/agents poll did. */
export interface RosterApplied {
  rows: any[]
  /** 'empty' is a real, earned answer — never filled with an invented cast. */
  state: 'ready' | 'empty'
  liveness: RosterLiveness
}

/**
 * Apply one roster poll result: the rows the floor is built from AND the
 * heartbeat facts the floor now paints.
 *
 * Before this, the Office threw the liveness half of /api/agents' answer away
 * — it read `agents` and nothing else, while CrewTab read `lastSeenAt`,
 * `lastSeenSource` and the envelope's `livenessSource` from the very same
 * body. One request, two consumers, two different answers to "is this agent
 * alive". They now come from one parse.
 */
export function applyRosterOutcome(
  body: unknown,
  rosterRef: Cell<any[] | null>,
  livenessRef: Cell<RosterLiveness>,
  now: number = Date.now(),
): RosterApplied {
  const rows: any[] = Array.isArray(body)
    ? body
    : (body && Array.isArray((body as any).agents) ? (body as any).agents : [])
  rosterRef.current = rows
  const liveness = livenessFromAgentsBody(body, now)
  livenessRef.current = liveness
  return { rows, state: rows.length > 0 ? 'ready' : 'empty', liveness }
}

// ─── The draw call ───────────────────────────────────────────────────────────

/**
 * Every ref the per-frame draw reads. Handed in as REFS, not as values.
 *
 * That is the mutation-resistance argument, and it is worth stating because it
 * looks like indirection for its own sake. Four of the critic's survivors were
 * of the form `boardTasks: boardTasksRef.current` -> `boardTasks: {}` — a
 * junk VALUE substituted at a call site no test executes. There is no longer a
 * call site with values in it. To plant the same mutation you must now edit
 * `drawOptionsFromRefs` below, which `__tests__/office-wiring.test.ts` calls
 * with distinguishable data and asserts property by property.
 *
 * `selectedIdRef` is a ref for a second reason, and it is a BUG FIX rather
 * than a test convenience. `selectedId` used to be read straight from props
 * inside the simulation effect, whose dependency array is `[addFeed,addToast]`
 * — and both of those are `useCallback(…, [])` in components/AgentOffice.tsx
 * (lines 37-44), so they never change identity and the effect never re-runs.
 * The value the draw call saw was therefore the one captured at mount, which
 * is `useState<string|null>(null)`'s initial `null`, forever. Clicking an
 * agent set the parent's state and highlighted nothing on the canvas. The
 * critic planted `selectedId -> null` and reported it as a surviving mutant;
 * it survived because it was a no-op on already-dead code. OfficeCanvas now
 * syncs `selectedIdRef` in its own effect, the same way it already syncs the
 * other nine props it reads from inside that loop.
 */
export interface OfficeDrawRefs {
  boardTasksRef: Cell<Record<string, string>>
  subagentCountRef: Cell<number>
  liveRunsRef: Cell<Record<string, AgentRunInfo>>
  waitingRef: Cell<Record<string, number>>
  livenessRef: Cell<RosterLiveness>
  selectedIdRef: Cell<string | null>
}

/** The per-frame values that are genuinely per-frame and cannot be refs. */
export interface OfficeFrame {
  T: number
  now: number
  cam: any
  darkAlpha: number
}

/**
 * Build the options object `drawAgents` is called with.
 *
 * Nothing is defaulted and nothing is optional: every field comes from a named
 * ref, so a missing one is a `tsc` error rather than a silently empty map.
 */
export function drawOptionsFromRefs(refs: OfficeDrawRefs, frame: OfficeFrame): DrawAgentsOptions {
  return {
    T: frame.T,
    now: frame.now,
    cam: frame.cam,
    darkAlpha: frame.darkAlpha,
    selectedId: refs.selectedIdRef.current,
    boardTasks: refs.boardTasksRef.current,
    subagentCount: refs.subagentCountRef.current,
    runs: refs.liveRunsRef.current,
    waiting: refs.waitingRef.current,
    liveness: refs.livenessRef.current.byId,
  }
}

/** The empty liveness picture OfficeCanvas's ref starts at, before any poll. */
export function emptyLiveness(): RosterLiveness {
  return { byId: {}, observed: false, counts: { live: 0, offline: 0, never: 0, unknown: 0 }, total: 0 }
}

// ─── The bubble is actionable ────────────────────────────────────────────────

/**
 * Where clicking a "waiting on you" bubble should take the operator.
 *
 * THE GAP THIS CLOSES. The benchmark's bubble is a live prompt you can answer;
 * ours was a read-only sticker. A surface whose entire claim is "a HUMAN has to
 * answer before this agent moves again" that then offers no way to answer is
 * telling the operator about a door it will not open. That was measured as a
 * loss against the benchmark and it was a fair one.
 *
 * The destination is derived from the CURRENT path rather than hardcoded,
 * because the Office renders at two URLs — `/fleet/office` and
 * `/p/<slug>/fleet/office` (app/page.tsx's parseURL resolves both) — and an
 * operator working inside a project must not be thrown out of it by answering
 * a question. Both forms were checked live on 2026-08-26: `/now/inbox` -> 200
 * and `/p/limiglow/now/inbox` -> 200.
 *
 * `now/inbox` is the pair components/nav/config.ts's LEGACY_TAB_MAP gives for
 * `inbox` (destination `now`, view `inbox`), read from that file rather than
 * guessed. This lane does not own it and does not modify it.
 */
export function inboxHrefFromPath(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] === 'p' && parts[1]) return `/p/${parts[1]}/now/inbox`
  return '/now/inbox'
}

/**
 * Is this click on the agent's speech bubble rather than on the agent?
 *
 * The bubble sits above the whole label stack, so a generous box around the
 * head would swallow clicks meant for the figure. This asks the narrower
 * question, and answers `false` for an agent with no bubble at all — there is
 * nothing there to click, and inventing a hidden hot-spot over an agent that
 * is NOT waiting would be the same fabrication in a different medium.
 */
export function bubbleHit(
  click: { x: number; y: number },
  agent: { px: number; py: number; isOrchestrator?: boolean },
  waitingCount: number,
  T: number,
): boolean {
  if (waitingCount <= 0) return false
  const sz = agent.isOrchestrator ? T * 0.78 : T * 0.58
  const hs = sz / 2
  // The bubble's band above the head. Deliberately conservative in height and
  // generous in width: a click just under it belongs to the agent.
  const top = agent.py - hs - T * 1.35
  const bottom = agent.py - hs - T * 0.10
  const halfWidth = T * 1.1
  return click.y >= top && click.y <= bottom && Math.abs(click.x - agent.px) <= halfWidth
}
