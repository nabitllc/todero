// lib/agent-pause-ui.ts — pure decision logic behind
// components/crew/AgentDetailView.tsx's togglePause().
//
// Split out of the component so the wave-4 defect this piece exists to close
// — "an operator clicking Unpause sees full recovery even when PATCH
// /api/agent-pause returned ok:false or still_blocked_by" — can be pinned
// with a plain unit test. This repo's jest config runs testEnvironment:
// "node" with no @testing-library/react / jsdom, so a function the
// component calls (rather than a rendered tree) is what's actually testable
// here; __tests__/api/agent-pause-route.test.ts already pins the route side
// of the same contract.

/** Shape of the JSON body PATCH /api/agent-pause answers with (route.ts). */
export interface AgentPauseResponseBody {
  ok: boolean
  is_paused: boolean
  message: string
  error?: string
  issue_unblocked?: boolean
  still_blocked_by?: string | null
}

export interface PauseOutcome {
  /** Next value for the component's `paused` state. `undefined` = leave it as-is. */
  paused?: boolean
  notice: { text: string; kind: 'warning' | 'error' } | null
}

/**
 * The route always answers HTTP 200 (see route.ts), so `res.ok` alone can
 * never tell a real recovery from a half-landed one. Two conditions must
 * BOTH hold before the operator is shown a lighter/"Active" state:
 *   1. `body.ok === true` — the write that carries the agent's own pause
 *      flag actually landed (a `false` here means e.g. the failure-counter
 *      reset upsert errored — see route.ts's `breakerResetError`).
 *   2. `body.still_blocked_by` is falsy — the issue the loop breaker (or a
 *      ceiling stop) blocked is actually re-dispatchable. A non-null value
 *      here means the agent-level flag did clear, but the agent still
 *      cannot do anything, so the UI must not report full recovery either.
 * Either failure leaves `paused` unset (the component keeps its current
 * value) and surfaces `body.error` / `body.still_blocked_by` via `message`
 * in a persistent notice instead of a toast that would disappear.
 */
export function resolvePauseOutcome(body: AgentPauseResponseBody): PauseOutcome {
  if (body.ok !== true) {
    return {
      notice: { text: body.error ? `${body.message} (${body.error})` : body.message, kind: 'error' },
    }
  }
  if (body.still_blocked_by) {
    return { notice: { text: body.message, kind: 'warning' } }
  }
  return { paused: body.is_paused, notice: null }
}
