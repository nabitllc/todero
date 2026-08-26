// ─── Office polling: the DECISIONS, extracted so they can be executed ────────
//
// WHY THIS FILE EXISTS.
//
// A fresh-context critic deleted `,waitingRef.current[ag.id]||0)` from
// OfficeCanvas's draw call — killing the speech bubble outright — and the
// three suites this lane shipped went 21/21 green, because every one of their
// "wiring" assertions was `readFileSync` + `toContain`. It then replaced that
// argument with the literal `1`, so all 28 agents showed a fabricated
// "waiting on you", and got 21/21 green again. It deleted the one line that
// stops the 5s re-render storm and got 21/21 green a third time. A source
// grep cannot tell you that a program still does the thing; it can only tell
// you that some characters are still present.
//
// This repo already learned that lesson once, at TOD-2467 (see the comment at
// app/page.tsx:512 about lib/issue-permalink.ts): the fix is to lift the
// DECISION out of the React component into a pure exported function, and then
// assert on what the function RETURNS. Everything in this file is a decision
// the Office used to make inline inside a `useEffect` or a `forEach`, where no
// test could reach it.
//
// What is still NOT covered by an executing test, stated plainly: the single
// expression in OfficeCanvas.tsx that passes `waitingRef.current` into
// `drawAgents(...)`, and the `useEffect` bodies that call these functions on a
// timer. Mounting OfficeCanvas would close that, and this repo has no jsdom
// (jest.config.js -> testEnvironment "node"); adding one is a package.json
// change and this lane does not own package.json. The residual seam is one
// named argument instead of a whole feature.

import type { ApiError } from '@/lib/fetch-json'
import { countWaitingByAgent } from './officeDrawing'

/** The shape `lib/fetch-json`'s `fetchJson` resolves to. */
export type PollResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

// ─── Poll intervals ──────────────────────────────────────────────────────────
// Named constants rather than literals at the call site so the cadence is one
// assertable value. A mutant that stretches the waiting poll to a day (the
// bubble goes 24h stale while still looking live) changes THIS number, and
// `office-polling.test.ts` fails on it.

/** How often the board-task poll re-reads `/api/issues`. */
export const BOARD_TASK_POLL_MS = 60_000
/** How often the "waiting on you" poll re-reads `/api/inbox`. */
export const WAITING_POLL_MS = 60_000
/**
 * How often the board-task MIRROR re-checks the ref. This is not a network
 * poll — it is how promptly OfficeCanvas's 60s fetch reaches the sidebar. It
 * can be short precisely because `createBoardTaskMirror` publishes nothing
 * when nothing changed.
 */
export const BOARD_TASK_MIRROR_TICK_MS = 5_000

// ─── Query strings ───────────────────────────────────────────────────────────

/**
 * The board-task read.
 *
 * `limit=0` is /api/issues' documented "unbounded" sentinel (route.ts:965),
 * NOT "zero rows".
 *
 * `all_projects=1` is NOT decoration, and its absence was a live defect. The
 * Office renders at two URLs: `/p/<slug>/fleet/office` and the bare
 * `/fleet/office` (app/page.tsx's parseURL resolves both). middleware.ts only
 * stamps the cross-project header `x-mc-all-projects` when it can find a
 * project segment to begin with — `projectFromPathname` returns null unless
 * the path contains `/p/<slug>` (middleware.ts:66-73) — so from the BARE
 * `/fleet/office` there is no resolved scope AND no cross-project stamp, and
 * app/api/issues/route.ts:1084 refuses with 400 `unscoped_issues_read`.
 *
 * Measured 2026-08-26 against the running dev server, each with a fresh query
 * string so the route's 30s cache could not answer for a different scope:
 *   Referer /p/limiglow/fleet/office  -> 200
 *   Referer /fleet/office             -> 400 {"error":"unscoped_issues_read"}
 *   no Referer                        -> 400
 *   ...&all_projects=1, any Referer   -> 200
 *
 * The route's own error body names the remedy — "pass all_projects=1 to read
 * across every project deliberately" — so this asks deliberately instead of
 * depending on the URL the operator happened to arrive by.
 */
export const BOARD_TASKS_QUERY = '/api/issues?status=in_progress&limit=0&all_projects=1'

/**
 * The "waiting on you" read. Unscoped on purpose: /api/inbox returns a BARE
 * ARRAY when `project=` is omitted and `{data,…}` when it is given (that
 * route's "TWO RESPONSE SHAPES" comment), and the Office wants the fleet-wide
 * array — the same leg OverviewTab's "Needs you" reads.
 */
export const WAITING_QUERY = '/api/inbox?status=pending'

// ─── Board tasks ─────────────────────────────────────────────────────────────

/**
 * Reduce an /api/issues body to `assignee -> title`.
 *
 * Returns `null` for a body this cannot read, which the caller treats as
 * "leave the previous map alone" rather than "nobody is working on anything".
 * An unreadable answer is not evidence of an empty board.
 */
export function boardTasksFromIssues(body: unknown): Record<string, string> | null {
  const rows = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) return null
  const map: Record<string, string> = {}
  for (const row of rows) {
    const t = row as { status?: unknown; assignee?: unknown; title?: unknown } | null
    if (t?.status !== 'in_progress') continue
    if (typeof t.assignee !== 'string' || !t.assignee) continue
    if (typeof t.title !== 'string' || !t.title) continue
    map[t.assignee] = t.title
  }
  return map
}

/**
 * What the board-task poll should do with one response.
 *
 * `tasks: null` means "do not touch the existing map". A failed request keeps
 * the last known board AND raises the banner, so the screen never silently
 * empties every desk because one request timed out.
 */
export function boardTaskPollOutcome(r: PollResult<unknown>): {
  tasks: Record<string, string> | null
  error: ApiError | null
} {
  if (!r.ok) return { tasks: null, error: r.error }
  return { tasks: boardTasksFromIssues(r.data), error: null }
}

// ─── Waiting on you ──────────────────────────────────────────────────────────

/**
 * What the "waiting on you" poll should do with one response.
 *
 * A FAILED poll must do BOTH things: drop every bubble AND raise the banner.
 * Dropping the counts alone would render a confident, silent "nobody is
 * waiting" over a question that was never answered — the exact failure this
 * whole surface exists to avoid. Both halves are returned from one function so
 * a test can assert they happen together, instead of grepping for two lines
 * that a refactor could separate.
 */
export function waitingPollOutcome(r: PollResult<unknown>): {
  waiting: Record<string, number>
  error: ApiError | null
} {
  if (!r.ok) return { waiting: {}, error: r.error }
  return { waiting: countWaitingByAgent(r.data), error: null }
}

/**
 * Split a waiting map into the part the canvas can actually draw and the part
 * it cannot.
 *
 * The canvas can only put a bubble over a head that exists, so a pending row
 * naming an agent that is not on the roster used to be counted and then
 * dropped on the floor by `waiting[ag.id] || 0` — no bubble, no notice, no
 * trace. A reviewing critic reported observing exactly that live on
 * 2026-08-26 — `/api/inbox?status=pending` naming `lane7-critic-agent`, which
 * is not among the ids `/api/agents` returns. I could not re-observe it (that
 * fixture is gone; `/api/inbox?status=pending` answers `[]` now), so treat the
 * sighting as reported, not as measured here. The hole it describes is real
 * regardless: the lookup below is what proves a row can be counted and then
 * dropped with nothing said.
 *
 * "Nowhere to draw it" is a fact about this canvas, not about the request. It
 * gets said out loud (see OfficeCanvas's unrouted-waiting feed line) instead
 * of being swallowed.
 */
export function partitionWaiting(
  waiting: Record<string, number>,
  rosterIds: Iterable<string>,
): { drawable: Record<string, number>; unroutedIds: string[]; unroutedRows: number } {
  const known = new Set(rosterIds)
  const drawable: Record<string, number> = {}
  const unroutedIds: string[] = []
  let unroutedRows = 0
  for (const [id, n] of Object.entries(waiting)) {
    if (known.has(id)) { drawable[id] = n; continue }
    unroutedIds.push(id)
    unroutedRows += n
  }
  unroutedIds.sort()
  return { drawable, unroutedIds, unroutedRows }
}

/** The one sentence the Office says when a pending row names nobody it can draw. */
export function unroutedWaitingMessage(unroutedIds: string[], unroutedRows: number): string | null {
  if (unroutedIds.length === 0 || unroutedRows === 0) return null
  const who = unroutedIds.length === 1 ? unroutedIds[0] : `${unroutedIds.length} agents`
  const rows = unroutedRows === 1 ? '1 request is' : `${unroutedRows} requests are`
  return `⚠ ${rows} waiting on you for ${who}, not on this floor — open the inbox`
}

// ─── The board-task mirror ───────────────────────────────────────────────────

/** True when two `assignee -> title` maps differ in any key or any value. */
export function boardTasksChanged(
  prev: Record<string, string> | null,
  next: Record<string, string>,
): boolean {
  if (!prev) return true
  const nextKeys = Object.keys(next)
  if (nextKeys.length !== Object.keys(prev).length) return true
  return !nextKeys.every(k => prev[k] === next[k])
}

/**
 * The publish decision for `hooks/useAgentStatus`'s board-task mirror, as an
 * object with real state, so a test can call `sync` twice and observe that the
 * second call published nothing.
 *
 * WHY THE COMPARE IS NOT AN OPTIMISATION. `setBoardTasks` is a plain useState
 * setter (components/AgentOffice.tsx:24). Publishing `{...ref.current}` on
 * every tick hands React a NEW OBJECT IDENTITY whether or not a character
 * changed; React compares by identity, so every tick re-rendered AgentOffice
 * and its children — including OfficeCanvas, which drives requestAnimationFrame
 * loops — 12× a minute on an idle office whose data refreshes once every 60s.
 *
 * The critic's mutant was deleting the "remember what we published" line. It
 * survived, because nothing executed this code. `sync` returning a boolean,
 * and `lastPublished()` being readable, is what makes that mutant fail now.
 */
export function createBoardTaskMirror(publish: (v: Record<string, string>) => void) {
  let last: Record<string, string> | null = null
  return {
    /** Publish `next` if and only if it differs from what was last published. */
    sync(next: Record<string, string>): boolean {
      if (!boardTasksChanged(last, next)) return false
      // Copy on publish: OfficeCanvas mutates/reassigns the ref this reads, so
      // handing the live object to React state would let a later write edit
      // the value React has already rendered — a UI that changed with no
      // re-render behind it.
      const snapshot = { ...next }
      last = snapshot
      publish(snapshot)
      return true
    },
    /** What was last handed to React, for tests and for debugging. */
    lastPublished(): Record<string, string> | null {
      return last
    },
  }
}
