/**
 * Regression test for piece "silent-write-failures", round 2.
 *
 * Critic finding, verbatim: "components/crew/AgentDetailView.tsx
 * togglePause() checks only the HTTP status and discards the body, so an
 * operator clicking Unpause sees full recovery even when PATCH
 * /api/agent-pause returned ok:false or still_blocked_by — the exact
 * wave-4 defect, re-created one layer up."
 *
 * `resolvePauseOutcome` (lib/agent-pause-ui.ts) is the exact function
 * AgentDetailView's togglePause() calls to decide whether local `paused`
 * state may advance. This repo's jest config (jest.config.js) runs
 * testEnvironment: "node" with no @testing-library/react / jsdom installed,
 * so a rendered-component test isn't available here — this pins the same
 * decision logic the component actually executes, the way
 * __tests__/api/agent-pause-route.test.ts pins the route side of the same
 * contract.
 */

import { resolvePauseOutcome, type AgentPauseResponseBody } from '@/lib/agent-pause-ui'

function body(overrides: Partial<AgentPauseResponseBody>): AgentPauseResponseBody {
  return {
    ok: true,
    is_paused: false,
    message: 'Agent has been un-paused.',
    ...overrides,
  }
}

describe('resolvePauseOutcome — togglePause() must not report full recovery on a half-landed write', () => {
  it('advances paused state on a clean success (ok:true, no still_blocked_by)', () => {
    const outcome = resolvePauseOutcome(body({ ok: true, is_paused: false, still_blocked_by: null }))
    expect(outcome.paused).toBe(false)
    expect(outcome.notice).toBeNull()
  })

  it('does NOT advance paused state when the body carries ok:false', () => {
    const outcome = resolvePauseOutcome(
      body({ ok: false, error: 'failure counter reset failed: unique_violation' })
    )
    expect(outcome.paused).toBeUndefined()
    expect(outcome.notice?.kind).toBe('error')
    expect(outcome.notice?.text).toMatch(/unique_violation/)
  })

  it('does NOT advance paused state when still_blocked_by is non-null, even though ok:true', () => {
    const outcome = resolvePauseOutcome(
      body({
        ok: true,
        is_paused: false,
        still_blocked_by: 'system:ceiling_stop:daily_cost',
        message:
          "Agent 'builder' un-paused, but issue TOD-999 is still blocked by system:ceiling_stop:daily_cost — not re-dispatchable.",
      })
    )
    expect(outcome.paused).toBeUndefined()
    expect(outcome.notice?.kind).toBe('warning')
    expect(outcome.notice?.text).toMatch(/TOD-999 is still blocked by system:ceiling_stop:daily_cost/)
    expect(outcome.notice?.text).toMatch(/not re-dispatchable/)
  })

  it('never returns a notice-less outcome when ok is false or still_blocked_by is set (regression guard)', () => {
    const failing: AgentPauseResponseBody[] = [
      body({ ok: false, error: 'connection reset' }),
      body({ ok: true, still_blocked_by: 'system:loop_breaker (clear failed: timeout)' }),
    ]
    for (const b of failing) {
      const outcome = resolvePauseOutcome(b)
      // This is the literal wave-4-recreated defect: advancing `paused`
      // while the operator is given nothing that says recovery was partial.
      expect(outcome.paused).toBeUndefined()
      expect(outcome.notice).not.toBeNull()
    }
  })
})
