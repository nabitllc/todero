/**
 * lib/fleet-liveness.ts — the activity half: what is it doing, and is it stuck?
 *
 * Kept in its own file rather than appended to fleet-liveness.test.ts because
 * that file's 31 cases are the regression guard for the heartbeat-vs-
 * registration fix, and mixing a new vocabulary into them makes it harder to
 * see which half broke.
 *
 * The property under test throughout is the one the whole module exists for:
 * a claim is only made when the fact behind it was actually observed. The
 * three ways to violate it here are
 *   1. calling a BOARD row ("this issue is assigned to builder") the agent's
 *      own work ("builder is working on it"),
 *   2. calling an agent stuck because it is quiet, when it never claimed to be
 *      doing anything in the first place,
 *   3. calling an agent stuck when the heartbeat store could not be read at
 *      all, so "quiet" was never observed.
 * Each has an explicit case below.
 */
import {
  describeActivity,
  summarizeActivity,
  activityHeadline,
  taskLabel,
  OFFLINE_AFTER_MS,
  type FleetActivityInput,
} from '@/lib/fleet-liveness'

const NOW = 1_700_000_000_000

function row(over: Partial<FleetActivityInput> = {}): FleetActivityInput {
  return {
    currentTask: null,
    currentTaskSource: 'none',
    workStartedAt: null,
    overCeiling: null,
    liveness: 'live',
    ...over,
  }
}

describe('describeActivity — idle', () => {
  it('says idle, and says WHY it is idle, when no source names a task', () => {
    const d = describeActivity(row(), NOW)
    expect(d.state).toBe('idle')
    expect(d.needsAttention).toBe(false)
    expect(d.label).toContain('neither a heartbeat nor a board row')
  })

  it('is idle even when the row is offline — that is the liveness badge’s job, not this one', () => {
    expect(describeActivity(row({ liveness: 'offline' }), NOW).state).toBe('idle')
  })

  it('is idle when a source is named but the task string is empty', () => {
    expect(describeActivity(row({ currentTaskSource: 'heartbeat', currentTask: '' }), NOW).state).toBe('idle')
    expect(describeActivity(row({ currentTaskSource: 'assigned-issue', currentTask: null }), NOW).state).toBe('idle')
  })
})

describe('describeActivity — working (the agent’s own claim)', () => {
  const working = row({ currentTaskSource: 'heartbeat', currentTask: 'TOD-9: rebuild the roster', liveness: 'live' })

  it('calls it working only when the heartbeat named the task AND the row is live', () => {
    const d = describeActivity(working, NOW)
    expect(d.state).toBe('working')
    expect(d.needsAttention).toBe(false)
  })

  it('attributes the claim to the agent, in those words', () => {
    expect(describeActivity(working, NOW).label).toContain('its own last heartbeat said so')
  })

  it('quotes the task rather than paraphrasing it', () => {
    expect(describeActivity(working, NOW).label).toContain('TOD-9: rebuild the roster')
  })
})

describe('describeActivity — stalled (the only thing it calls stuck on its own)', () => {
  const stalled = row({ currentTaskSource: 'heartbeat', currentTask: 'TOD-9', liveness: 'offline' })

  it('is stalled when the agent claimed work and then went offline', () => {
    const d = describeActivity(stalled, NOW)
    expect(d.state).toBe('stalled')
    expect(d.needsAttention).toBe(true)
  })

  it('names the silence window on screen, not in a developer’s head', () => {
    expect(describeActivity(stalled, NOW).label).toContain('10m')
  })

  it('renders whatever window it was actually given, not a hardcoded one', () => {
    const d = describeActivity(stalled, NOW, 90 * 60_000)
    expect(d.label).toContain('1h 30m')
    expect(d.label).not.toContain('10m')
  })

  it('says nothing reported the work finished — the honest gap, not a verdict', () => {
    expect(describeActivity(stalled, NOW).label).toContain('finished or failed')
  })

  /**
   * Violation #2. An agent that never claimed work is not stuck no matter how
   * long it has been quiet — the liveness badge already says it is offline,
   * and stacking "stalled" on top invents a task it never had.
   */
  it('does NOT call a quiet agent stalled when it never claimed any work', () => {
    const d = describeActivity(row({ liveness: 'offline' }), NOW)
    expect(d.state).toBe('idle')
    expect(d.needsAttention).toBe(false)
  })

  /**
   * Violation #3. `unknown` means the heartbeat store could not be read, so
   * "it went quiet" was never observed. Claiming stalled from that is making a
   * claim from an absence of evidence — this module's founding refusal.
   */
  it.each(['never', 'unknown'] as const)(
    'does NOT call it stalled when liveness is %s — nothing was observed to go quiet',
    liveness => {
      const d = describeActivity(row({ currentTaskSource: 'heartbeat', currentTask: 'TOD-9', liveness }), NOW)
      expect(d.state).toBe('assigned')
      expect(d.needsAttention).toBe(false)
      expect(d.label).toContain('cannot be told from here')
    },
  )
})

describe('describeActivity — assigned (the BOARD’s claim, never laundered into the agent’s)', () => {
  const assigned = row({
    currentTaskSource: 'assigned-issue',
    currentTask: 'TOD-42: fix the nav',
    liveness: 'never',
  })

  /**
   * Violation #1 — the reason `currentTaskSource` was added to the API at all.
   * Before it, GET /api/agents handed an assigned issue and a heartbeat task
   * to the UI through one nullable string.
   */
  it('never calls a board assignment "working"', () => {
    const d = describeActivity(assigned, NOW)
    expect(d.state).toBe('assigned')
    expect(d.label).not.toContain('working on')
  })

  it('says in words that it is a board row and not a check-in', () => {
    const d = describeActivity(assigned, NOW)
    expect(d.label).toContain('board row, not a check-in')
    expect(d.label).toContain('no heartbeat has reported work on it')
  })

  it('does not flag it for attention — every board in this repo looks like this at rest', () => {
    expect(describeActivity(assigned, NOW).needsAttention).toBe(false)
  })

  it('reports how long the ISSUE has been in progress when the board says', () => {
    const d = describeActivity({ ...assigned, workStartedAt: NOW - 3 * 3_600_000 }, NOW)
    expect(d.label).toContain('in progress 3h')
  })

  it('reports no duration at all when the board carries no start time', () => {
    expect(describeActivity(assigned, NOW).label).not.toContain('in progress')
  })

  it('refuses to render a negative duration from a start time in the future', () => {
    const d = describeActivity({ ...assigned, workStartedAt: NOW + 60_000 }, NOW)
    // Exact rather than a substring ban: the task key "TOD-42" contains a
    // hyphen-digit and "check-in" contains a hyphen, so any pattern loose
    // enough to catch "in progress -1m" also catches those. A future start
    // time must produce the SAME sentence as no start time at all, and that
    // is checkable outright.
    expect(d.label).toBe(describeActivity({ ...assigned, workStartedAt: null }, NOW).label)
    expect(d.label).not.toContain('in progress')
  })

  it('stays assigned even when the row is live — a live agent is not proof it took the ticket', () => {
    expect(describeActivity({ ...assigned, liveness: 'live' }, NOW).state).toBe('assigned')
  })
})

describe('describeActivity — blocked outranks everything', () => {
  const ceiling = { ceiling: 'daily_usd', reason: 'spent $12.40 of a $10.00 daily cap' }

  it('reports the ceiling and the server’s own reason text verbatim', () => {
    const d = describeActivity(row({ overCeiling: ceiling }), NOW)
    expect(d.state).toBe('blocked')
    expect(d.needsAttention).toBe(true)
    expect(d.label).toContain('daily_usd')
    expect(d.label).toContain('spent $12.40 of a $10.00 daily cap')
  })

  it('outranks a live agent’s own working claim — it cannot run whatever it thinks', () => {
    const d = describeActivity(
      row({ overCeiling: ceiling, currentTaskSource: 'heartbeat', currentTask: 'TOD-9', liveness: 'live' }),
      NOW,
    )
    expect(d.state).toBe('blocked')
  })

  it('says the reason text was missing rather than inventing one', () => {
    const d = describeActivity(row({ overCeiling: { ceiling: 'runs_per_hour', reason: '   ' } }), NOW)
    expect(d.label).toContain('the server reported no reason text')
  })
})

describe('badge can never drift from state', () => {
  const all: FleetActivityInput[] = [
    row(),
    row({ currentTaskSource: 'heartbeat', currentTask: 't', liveness: 'live' }),
    row({ currentTaskSource: 'heartbeat', currentTask: 't', liveness: 'offline' }),
    row({ currentTaskSource: 'assigned-issue', currentTask: 't', liveness: 'never' }),
    row({ overCeiling: { ceiling: 'c', reason: 'r' } }),
  ]
  it.each(all.map((r, i) => [i, r] as const))('case %i', (_i, r) => {
    const d = describeActivity(r, NOW)
    expect(d.badge).toBe(d.state)
  })
})

describe('summarizeActivity', () => {
  const rows: FleetActivityInput[] = [
    row({ currentTaskSource: 'heartbeat', currentTask: 'a', liveness: 'live' }),
    row({ currentTaskSource: 'heartbeat', currentTask: 'b', liveness: 'live' }),
    row({ currentTaskSource: 'heartbeat', currentTask: 'c', liveness: 'offline' }),
    row({ currentTaskSource: 'assigned-issue', currentTask: 'd', liveness: 'never' }),
    row({ overCeiling: { ceiling: 'daily_usd', reason: 'over' } }),
    row(),
  ]

  it('counts every row exactly once across the five states', () => {
    const s = summarizeActivity(rows, NOW)
    expect(s.working + s.stalled + s.blocked + s.assigned + s.idle).toBe(rows.length)
    expect(s).toMatchObject({ working: 2, stalled: 1, blocked: 1, assigned: 1, idle: 1 })
  })

  it('counts needsAttention as exactly blocked + stalled', () => {
    const s = summarizeActivity(rows, NOW)
    expect(s.needsAttention).toBe(s.blocked + s.stalled)
  })

  it('is all zeroes for an empty fleet, never a guess', () => {
    expect(summarizeActivity([], NOW)).toEqual({
      blocked: 0, working: 0, stalled: 0, assigned: 0, idle: 0, needsAttention: 0,
    })
  })

  it('uses the same offline window it is handed, so it cannot disagree with the rows', () => {
    const quiet = [row({ currentTaskSource: 'heartbeat', currentTask: 'x', liveness: 'offline' })]
    expect(summarizeActivity(quiet, NOW, OFFLINE_AFTER_MS).stalled).toBe(1)
  })
})

describe('activityHeadline', () => {
  it('names only non-zero states — no "0 stalled" for the operator to triage', () => {
    const h = activityHeadline(summarizeActivity([row()], NOW))
    expect(h).toContain('1 idle')
    expect(h).not.toContain('0 ')
  })

  it('says nothing is waiting on you, in words, rather than falling silent', () => {
    expect(activityHeadline(summarizeActivity([row()], NOW))).toContain('nothing is waiting on you')
  })

  it('counts what needs you, and agrees in number', () => {
    const s = summarizeActivity(
      [
        row({ currentTaskSource: 'heartbeat', currentTask: 'a', liveness: 'offline' }),
        row({ overCeiling: { ceiling: 'c', reason: 'r' } }),
      ],
      NOW,
    )
    expect(activityHeadline(s)).toContain('2 need you')
  })

  it('says "needs" for one and "need" for many', () => {
    const one = summarizeActivity([row({ currentTaskSource: 'heartbeat', currentTask: 'a', liveness: 'offline' })], NOW)
    expect(activityHeadline(one)).toContain('1 needs you')
  })

  it('has something to say about an empty fleet rather than an empty string', () => {
    expect(activityHeadline(summarizeActivity([], NOW))).toContain('no rows to describe')
  })
})

/**
 * ROUND 2. `taskLabel()` is the same fact as `describeActivity().label` for
 * surfaces with no room for a sentence — the five listed in the module comment
 * that render `currentTask` as one truncated string. It ships on the wire as
 * `AgentDto.currentTaskLabel`.
 *
 * The property that makes it worth having is POSITIONAL, which is why it is
 * asserted with `startsWith` rather than `toContain`: every one of those call
 * sites renders inside a CSS `truncate`, which cuts the tail. A label whose
 * provenance is at the end truncates back into the ambiguous string it
 * replaced.
 */
describe('taskLabel — provenance first, because truncation eats the tail', () => {
  it('prefixes the agent own report with "reported: "', () => {
    expect(taskLabel({ currentTask: 'TOD-9: rebuild', currentTaskSource: 'heartbeat' }))
      .toBe('reported: TOD-9: rebuild')
  })

  it('prefixes a board row with "assigned: ", never with "reported: "', () => {
    const label = taskLabel({ currentTask: 'TOD-9: rebuild', currentTaskSource: 'assigned-issue' })
    expect(label).toBe('assigned: TOD-9: rebuild')
    expect(label!.startsWith('reported:')).toBe(false)
  })

  it('puts the provenance word FIRST, so a truncated label still carries it', () => {
    for (const source of ['heartbeat', 'assigned-issue'] as const) {
      const label = taskLabel({ currentTask: 'a very long task title that will certainly be cut off', currentTaskSource: source })!
      // The first eight characters alone disambiguate the two facts.
      expect(label.slice(0, 8)).toBe(source === 'heartbeat' ? 'reported' : 'assigned')
    }
  })

  it('returns null — not an empty string — when there is no task', () => {
    expect(taskLabel({ currentTask: null, currentTaskSource: 'none' })).toBeNull()
    expect(taskLabel({ currentTask: '', currentTaskSource: 'heartbeat' })).toBeNull()
    expect(taskLabel({ currentTask: '   ', currentTaskSource: 'heartbeat' })).toBeNull()
  })

  /**
   * The fail-closed case, and the reason this is a function rather than a
   * template literal at each call site: a source value that is not 'heartbeat'
   * must take the WEAKER branch. "The board says so" over-claims nothing; "the
   * agent reported it" over-claims everything.
   */
  it('falls to the board wording for any source that is not "heartbeat"', () => {
    expect(taskLabel({ currentTask: 'TOD-9', currentTaskSource: 'none' })).toBe('assigned: TOD-9')
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately off-contract
      taskLabel({ currentTask: 'TOD-9', currentTaskSource: 'something-new' as any }),
    ).toBe('assigned: TOD-9')
  })

  it('agrees with describeActivity about which fact it is holding', () => {
    const board = { currentTask: 'TOD-9', currentTaskSource: 'assigned-issue' as const }
    expect(taskLabel(board)!.startsWith('assigned')).toBe(true)
    expect(describeActivity(row({ ...board, liveness: 'live' }), NOW).state).toBe('assigned')

    const own = { currentTask: 'TOD-9', currentTaskSource: 'heartbeat' as const }
    expect(taskLabel(own)!.startsWith('reported')).toBe(true)
    expect(describeActivity(row({ ...own, liveness: 'live' }), NOW).state).toBe('working')
  })
})
