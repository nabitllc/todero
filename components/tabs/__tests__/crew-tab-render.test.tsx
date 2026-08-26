/**
 * components/tabs/__tests__/crew-tab-render.test.tsx — the roster row's WIRING.
 *
 * ─── WHY THIS FILE EXISTS (ROUND 3) ──────────────────────────────────────────
 *
 * crew-tab-activity.test.ts, this lane's other component suite, opens by
 * admitting "There is no DOM assertion here and none is implied: this repo has
 * no testing-library, so what is tested is the pure mapping the render reads
 * from, not the pixels." That was true and honestly stated, and it left a
 * precise hole: the pure functions were well covered, and NOTHING checked that
 * the render calls them.
 *
 * A fresh-context critic walked straight through it with two one-token
 * mutations, each of which left all 141 lane tests green and `tsc` clean:
 *
 *   1. `const blocked = ceilingRefusal(row)` -> `const blocked = null`
 *      in RunControl. This un-wires round 2's OWN fix at its only call site:
 *      the Launch button re-arms over a budget ceiling — exactly the defect
 *      that fix was written to repair. The round-2 doc described the button as
 *      guarded ("null is what arms the button"); only the helper was tested.
 *
 *   2. the activity badge's `{act.badge}` -> `{desc.badge}`. Every row then
 *      prints its LIVENESS word ('never', 'live') in the slot that answers
 *      "what is it doing" — two badges showing one fact, on the surface whose
 *      entire purpose is keeping those two facts apart.
 *
 * The repo still has no testing-library. It does not need one for this:
 * `react-dom/server`'s `renderToStaticMarkup` is already a dependency (react-dom
 * 18.3.1), runs under `testEnvironment: "node"`, and returns real markup. Only
 * effects are skipped, and neither component below has any — `RosterRow` and
 * `RunControl` were made exported, prop-only components in round 3 so they can
 * be rendered without RosterCard's fetches.
 *
 * These are assertions about MARKUP, not about pixels. Tone classes, phone
 * width, and colour remain unverified here and are listed as such in the piece
 * doc — this file does not claim to have looked at the screen.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RosterRow, RunControl, type AgentsEnvelope, type RosterRowData } from '../CrewTab'

const NOW = 1_700_000_000_000
const OBSERVED_ENV = { livenessSource: 'heartbeat', agents: [] } as unknown as AgentsEnvelope

function row(over: Partial<RosterRowData> = {}): RosterRowData {
  return { id: 'a', name: 'Agent A', lastSeenAt: null, ...over } as RosterRowData
}

const render = (el: React.ReactElement) => renderToStaticMarkup(el)

/** The text inside the element carrying `data-testid="<id>"`. */
function testId(html: string, id: string): string {
  const m = html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>([\\s\\S]*?)</`))
  if (!m) throw new Error(`no element with data-testid="${id}" in:\n${html}`)
  return m[1]
}

// ─── MUTANT 2: RunControl must consult ceilingRefusal ─────────────────────────

describe('RunControl — the ceiling gate is WIRED, not merely available', () => {
  const OVER = {
    overCeiling: { ceiling: 'daily-usd', reason: 'spent $12.40 of $10.00' },
  }

  it('MUTANT `const blocked = null`: an over-ceiling row renders a DISABLED control', () => {
    const html = render(<RunControl dispatchEnabled reason={null} row={row(OVER)} />)
    expect(html).toContain('Run — over ceiling')
    expect(html).toContain('disabled')
    // The armed control must NOT be what rendered.
    expect(html).not.toContain('Launch')
  })

  it('carries the server own refusal text as the title, not a paraphrase', () => {
    const html = render(<RunControl dispatchEnabled reason={null} row={row(OVER)} />)
    expect(html).toContain('daily-usd')
    expect(html).toContain('spent $12.40 of $10.00')
  })

  it('a row WITHIN every ceiling is not disabled by this branch', () => {
    const html = render(<RunControl dispatchEnabled reason={null} row={row({ overCeiling: null })} />)
    expect(html).not.toContain('Run — over ceiling')
  })

  it('dispatch off still outranks everything, and says why', () => {
    const html = render(
      <RunControl dispatchEnabled={false} reason="dispatch is off on this host" row={row(OVER)} />,
    )
    expect(html).toContain('Run — disabled')
    expect(html).toContain('dispatch is off on this host')
  })

  it('an unknown dispatch verdict arms nothing', () => {
    const html = render(<RunControl dispatchEnabled={null} reason={null} row={row(OVER)} />)
    expect(html).toContain('checking dispatch')
    expect(html).not.toContain('Run — over ceiling')
  })
})

// ─── MUTANT 3: the two badges must answer two different questions ─────────────

describe('RosterRow — the activity badge shows ACTIVITY, not liveness', () => {
  /**
   * A row that is live AND blocked: the liveness badge must read 'live' and
   * the activity badge 'blocked'. Under the mutation both read 'live', which
   * is what makes this fixture the one that catches it — a row whose two
   * states differ. A fixture where they coincide proves nothing.
   */
  const LIVE_AND_BLOCKED = row({
    lastSeenAt: NOW - 5_000,
    lastSeenSource: 'heartbeat',
    overCeiling: { ceiling: 'daily-usd', reason: 'over budget' },
  })

  it('MUTANT `{desc.badge}`: the two badges differ when the two facts differ', () => {
    const html = render(
      <RosterRow row={LIVE_AND_BLOCKED} env={OBSERVED_ENV} now={NOW} dispatch={null} onOpen={() => {}} />,
    )
    const liveness = testId(html, 'liveness-badge')
    const activity = testId(html, 'activity-badge')
    expect(liveness).toBe('live')
    expect(activity).toBe('blocked')
    expect(activity).not.toBe(liveness)
  })

  it('the activity badge never prints a LIVENESS word', () => {
    const livenessWords = ['live', 'offline', 'never', 'not measured']
    const html = render(
      <RosterRow row={LIVE_AND_BLOCKED} env={OBSERVED_ENV} now={NOW} dispatch={null} onOpen={() => {}} />,
    )
    expect(livenessWords).not.toContain(testId(html, 'activity-badge'))
  })

  it('a heartbeat-sourced task renders as the agent own claim', () => {
    const html = render(
      <RosterRow
        row={row({
          lastSeenAt: NOW - 5_000,
          lastSeenSource: 'heartbeat',
          currentTask: 'TOD-42: fix the nav',
          currentTaskSource: 'heartbeat',
        })}
        env={OBSERVED_ENV}
        now={NOW}
        dispatch={null}
        onOpen={() => {}}
      />,
    )
    expect(testId(html, 'activity-badge')).toBe('working')
    expect(testId(html, 'activity-label')).toContain('its own last heartbeat said so')
  })

  it('a BOARD-sourced task is never worded as a check-in', () => {
    const html = render(
      <RosterRow
        row={row({
          lastSeenAt: NOW - 5_000,
          lastSeenSource: 'heartbeat',
          currentTask: 'TOD-42: fix the nav',
          currentTaskSource: 'assigned-issue',
          workStartedAt: NOW - 3 * 60 * 60 * 1000,
        })}
        env={OBSERVED_ENV}
        now={NOW}
        dispatch={null}
        onOpen={() => {}}
      />,
    )
    expect(testId(html, 'activity-badge')).toBe('assigned')
    const label = testId(html, 'activity-label')
    expect(label).toContain('that is a board row, not a check-in')
    expect(label).not.toContain('its own last heartbeat said so')
    // MUTANT `workStartedAt: null` at the route reaches the screen HERE: this
    // clause is the only duration evidence an assigned row carries.
    expect(label).toContain('It has been in progress 3h.')
  })

  it('the row renders the agent name and its liveness sentence', () => {
    const html = render(<RosterRow row={row()} env={OBSERVED_ENV} now={NOW} dispatch={null} onOpen={() => {}} />)
    expect(html).toContain('Agent A')
    expect(testId(html, 'liveness-badge')).toBe('never')
  })
})
