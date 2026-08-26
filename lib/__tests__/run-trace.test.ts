/**
 * runs-traces piece — lib/run-trace.ts.
 *
 * Every case here is written to FAIL against the behaviour this piece
 * replaces, not merely to pass against the one it ships. The behaviour being
 * replaced is the repo's recurring defect: a component that renders a
 * plausible-looking breakdown over data it does not have — a 100% bar drawn
 * from no token counts, a `$0.00` column on a run that never touched a paid
 * provider, a `0` standing in for "never measured", a ceiling number typed
 * into JSX instead of read from lib/agent-budget.ts.
 *
 * So each block below names the fabrication it forbids.
 */

import {
  NO_STEPS_MESSAGE,
  ceilingRows,
  ceilingSourceNote,
  costByStep,
  formatLimitMs,
  formatMs,
  formatStepNo,
  formatTokens,
  formatUsd,
  normalizeStepRow,
  formatStepCost,
  runTouchedProvider,
  traceTotals,
  validateStepWrite,
  type RunBudget,
  type RunStepRow,
} from '../run-trace'

// ─── fixtures ───────────────────────────────────────────────────────────────

function step(patch: Partial<RunStepRow>): RunStepRow {
  return {
    id: `s${patch.step_no ?? 1}`,
    run_id: 'r1',
    step_no: 1,
    tool: 'read',
    what: 'did a thing',
    detail: null,
    tokens: null,
    duration_ms: null,
    ok: true,
    cost_usd: null,
    provider: null,
    created_at: '2026-08-26T00:00:00.000Z',
    ...patch,
  }
}

/** A local run: real tokens and durations, NO dollar figure anywhere. */
const LOCAL_RUN: RunStepRow[] = [
  step({ step_no: 1, tool: 'read', what: 'AGENTS.md, SOUL.md', tokens: 8100, duration_ms: 340 }),
  step({ step_no: 2, tool: 'grep', what: 'located the anti-pattern', tokens: 2400, duration_ms: 210 }),
  step({ step_no: 3, tool: 'edit', what: 'components/tabs/IssuesTab.tsx', tokens: 6900, duration_ms: 1200 }),
  step({ step_no: 4, tool: 'bash', what: 'npx tsc --noEmit', tokens: 3100, duration_ms: 18400, ok: false, detail: 'exit 1' }),
  step({ step_no: 5, tool: 'edit', what: 'corrected the hook return type', tokens: 4800, duration_ms: 890 }),
]

/** The same run routed to a paid provider: cost_usd is a real number. */
const PAID_RUN: RunStepRow[] = LOCAL_RUN.map((s, i) => ({ ...s, cost_usd: [0.012, 0.004, 0.031, 0.008, 0.02][i], provider: 'anthropic' }))

const BUDGET: RunBudget = {
  period: 'daily',
  limitUsd: null,
  maxConcurrentPerAgent: 1,
  maxRunMs: 3_600_000,
  noProgressHeartbeats: 3,
  maxRunsPerPeriod: 20,
  source: 'default',
}

// ─── the dollar column's condition ──────────────────────────────────────────

describe('runTouchedProvider — forbids a $0.00 column on a local run', () => {
  it('is FALSE when every step has a null cost_usd', () => {
    // The fabrication this forbids: summing `cost_usd ?? 0` across the run,
    // getting 0, and rendering "$0.00" as though it were measured.
    expect(runTouchedProvider(LOCAL_RUN)).toBe(false)
  })

  it('is TRUE as soon as ONE step carries a number', () => {
    expect(runTouchedProvider(PAID_RUN)).toBe(true)
    expect(runTouchedProvider([...LOCAL_RUN, step({ step_no: 6, cost_usd: 0.0001 })])).toBe(true)
  })

  it('is TRUE for a recorded ZERO — a measured $0 is not an absent measurement', () => {
    // A cache hit on a paid provider really did cost $0. That is a number and
    // the column must appear; only `null` means nobody measured.
    expect(runTouchedProvider([step({ step_no: 1, cost_usd: 0 })])).toBe(true)
  })

  it('is FALSE for a run with no steps at all', () => {
    expect(runTouchedProvider([])).toBe(false)
  })
})

// ─── cost by step ───────────────────────────────────────────────────────────

describe('costByStep — forbids a breakdown drawn from nothing', () => {
  it('returns NO groups when every step recorded a null token count', () => {
    // The fabrication this forbids: one full-width bar labelled 100% over a
    // total of zero. There is nothing to divide, so there are no groups.
    const out = costByStep([step({ step_no: 1, tool: 'read' }), step({ step_no: 2, tool: 'edit' })])
    expect(out.groups).toEqual([])
    expect(out.totalTokens).toBe(0)
    expect(out.stepsWithoutTokens).toBe(2)
  })

  it('groups by the RECORDED tool string, not a hand-written phase taxonomy', () => {
    const out = costByStep(LOCAL_RUN)
    expect(out.groups.map(g => g.tool).sort()).toEqual(['bash', 'edit', 'grep', 'read'])
    // edit appears twice in the fixture and must be summed, not listed twice.
    expect(out.groups.find(g => g.tool === 'edit')!.tokens).toBe(6900 + 4800)
    expect(out.groups.find(g => g.tool === 'edit')!.steps).toBe(2)
  })

  it('percentages sum to exactly 100 over real rows', () => {
    const out = costByStep(LOCAL_RUN)
    expect(out.groups.reduce((s, g) => s + g.pct, 0)).toBe(100)
    expect(out.totalTokens).toBe(8100 + 2400 + 6900 + 3100 + 4800)
  })

  it('percentages still sum to exactly 100 where naive rounding would not', () => {
    // Three equal shares round to 33 each -> 99 with naive rounding. The
    // largest-remainder method must recover the missing point.
    const thirds = [
      step({ step_no: 1, tool: 'a', tokens: 100 }),
      step({ step_no: 2, tool: 'b', tokens: 100 }),
      step({ step_no: 3, tool: 'c', tokens: 100 }),
    ]
    const out = costByStep(thirds)
    expect(out.groups.reduce((s, g) => s + g.pct, 0)).toBe(100)
  })

  it('excludes an unmeasured step from the total instead of counting it as zero', () => {
    const mixed = [step({ step_no: 1, tool: 'read', tokens: 1000 }), step({ step_no: 2, tool: 'read', tokens: null })]
    const out = costByStep(mixed)
    expect(out.totalTokens).toBe(1000)
    expect(out.stepsWithoutTokens).toBe(1)
    // The group still knows it covers 2 steps — the step is named, not erased.
    expect(out.groups[0].steps).toBe(2)
  })

  it('leaves a group cost null on a local run and sums it on a paid one', () => {
    expect(costByStep(LOCAL_RUN).groups.every(g => g.costUsd === null)).toBe(true)
    expect(costByStep(LOCAL_RUN).totalCostUsd).toBeNull()
    expect(costByStep(PAID_RUN).totalCostUsd).toBeCloseTo(0.075, 6)
  })
})

// ─── totals ─────────────────────────────────────────────────────────────────

describe('traceTotals — null is not zero', () => {
  it('reports null tokens/duration/cost when NOTHING recorded them', () => {
    const out = traceTotals([step({ step_no: 1 }), step({ step_no: 2 })])
    expect(out.steps).toBe(2)
    expect(out.tokens).toBeNull()
    expect(out.durationMs).toBeNull()
    expect(out.costUsd).toBeNull()
  })

  it('counts failed steps from the ok column', () => {
    expect(traceTotals(LOCAL_RUN).failedSteps).toBe(1)
    expect(traceTotals(LOCAL_RUN).tokens).toBe(25300)
    expect(traceTotals(LOCAL_RUN).durationMs).toBe(340 + 210 + 1200 + 18400 + 890)
  })
})

// ─── formatting ─────────────────────────────────────────────────────────────

describe('formatters — an em dash for absent, a digit only for measured', () => {
  it('formatTokens(null) is an em dash, never "0"', () => {
    expect(formatTokens(null)).toBe('—')
    expect(formatTokens(null)).not.toBe('0')
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(8100)).toBe('8.1k')
    expect(formatTokens(999)).toBe('999')
  })

  it('formatUsd(null) is an em dash, never "$0.00"', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(null)).not.toBe('$0.00')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.0004)).toBe('$0.0004')
    expect(formatUsd(1.5)).toBe('$1.50')
    // A sub-dollar figure is NOT rounded into cents — $0.0060 must not read
    // as $0.01, which would be a rounded number shown as the recorded one.
    expect(formatUsd(0.006)).toBe('$0.0060')
    expect(formatUsd(0.027)).toBe('$0.0270')
  })

  it('formatMs(null) is an em dash; real values scale', () => {
    expect(formatMs(null)).toBe('—')
    expect(formatMs(340)).toBe('340ms')
    expect(formatMs(18400)).toBe('18.4s')
    expect(formatMs(291000)).toBe('4m 51s')
  })

  it('formatLimitMs renders a whole-minute ceiling as minutes', () => {
    expect(formatLimitMs(3_600_000)).toBe('60m')
    expect(formatLimitMs(90_000)).toBe('1m 30s')
  })

  it('formatStepNo pads to the gutter width design/Run.dc.html uses', () => {
    expect(formatStepNo(1)).toBe('01')
    expect(formatStepNo(14)).toBe('14')
  })
})

// ─── validation ─────────────────────────────────────────────────────────────

describe('validateStepWrite — fail closed, like hub-settings', () => {
  const valid = { run_id: 'r1', step_no: 1, tool: 'bash', what: 'npx tsc --noEmit' }

  it('accepts a minimal body and normalises the nullable columns to null, not 0', () => {
    const v = validateStepWrite(valid)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.value.tokens).toBeNull()
    expect(v.value.duration_ms).toBeNull()
    expect(v.value.cost_usd).toBeNull()
    expect(v.value.ok).toBe(true)
  })

  it('REFUSES an unknown key with a 400 that names it — never stores it, never drops it', () => {
    const v = validateStepWrite({ ...valid, sneaky: 'value' })
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.status).toBe(400)
    expect(v.why).toContain('sneaky')
    expect(v.why).toContain('known fields')
  })

  it('rejects a non-object body', () => {
    for (const body of [null, 'x', 42, ['a']]) {
      const v = validateStepWrite(body)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.status).toBe(400)
    }
  })

  it('rejects step_no 0, negative, and non-integer — the gutter is 1-based', () => {
    for (const step_no of [0, -1, 1.5, 'two']) {
      const v = validateStepWrite({ ...valid, step_no })
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.status).toBe(422)
    }
  })

  it('rejects a missing or blank tool / what', () => {
    for (const patch of [{ tool: '' }, { tool: undefined }, { what: '   ' }, { what: undefined }]) {
      const v = validateStepWrite({ ...valid, ...patch })
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.status).toBe(422)
    }
  })

  it('rejects a negative or non-integer tokens / duration_ms', () => {
    expect(validateStepWrite({ ...valid, tokens: -1 }).ok).toBe(false)
    expect(validateStepWrite({ ...valid, tokens: 1.5 }).ok).toBe(false)
    expect(validateStepWrite({ ...valid, duration_ms: -5 }).ok).toBe(false)
  })

  it('rejects a negative cost_usd but ACCEPTS an explicit 0 and preserves it', () => {
    expect(validateStepWrite({ ...valid, cost_usd: -0.01 }).ok).toBe(false)
    const v = validateStepWrite({ ...valid, cost_usd: 0 })
    expect(v.ok).toBe(true)
    // Preserved as 0, not collapsed to null — a measured zero must keep the
    // dollar column visible.
    if (v.ok) expect(v.value.cost_usd).toBe(0)
  })

  it('rejects a non-boolean ok', () => {
    expect(validateStepWrite({ ...valid, ok: 'false' }).ok).toBe(false)
    const v = validateStepWrite({ ...valid, ok: false })
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.value.ok).toBe(false)
  })
})

// ─── reading back what an adapter returns ───────────────────────────────────

describe('normalizeStepRow — one dialect for two adapters', () => {
  it('reads sqlite 0/1 as a boolean', () => {
    expect(normalizeStepRow({ id: 'a', run_id: 'r', step_no: 1, tool: 't', what: 'w', ok: 0 }).ok).toBe(false)
    expect(normalizeStepRow({ id: 'a', run_id: 'r', step_no: 1, tool: 't', what: 'w', ok: 1 }).ok).toBe(true)
  })

  it('reads a numeric column handed back as a string, and keeps null as null', () => {
    const row = normalizeStepRow({ id: 'a', run_id: 'r', step_no: '2', tool: 't', what: 'w', cost_usd: '0.0120', tokens: null })
    expect(row.cost_usd).toBeCloseTo(0.012, 6)
    expect(row.tokens).toBeNull()
    expect(row.step_no).toBe(2)
  })
})

// ─── ceilings ───────────────────────────────────────────────────────────────

describe('ceilingRows — the real ceilings, and "triggered" only from a column', () => {
  const base = {
    startedAt: '2026-08-26T00:00:00.000Z',
    completedAt: '2026-08-26T00:04:51.000Z',
    stoppedReason: null as string | null,
    budget: BUDGET,
  }

  it('renders the wall clock as elapsed over the REAL maxRunMs', () => {
    const rows = ceilingRows(base)
    const wall = rows.find(r => r.key === 'Wall clock')!
    expect(wall.value).toBe('4m 51s / 60m')
    expect(wall.tone).toBe('ok')
  })

  it('says "not triggered" when stopped_reason is null', () => {
    const rows = ceilingRows(base)
    expect(rows.find(r => r.key === 'No-progress halt')!.value).toBe('not triggered')
    expect(rows.every(r => r.tone !== 'fail')).toBe(true)
  })

  it('says "triggered" ONLY for the ceiling stopped_reason names', () => {
    const rows = ceilingRows({ ...base, stoppedReason: 'no_progress' })
    const noProgress = rows.find(r => r.key === 'No-progress halt')!
    expect(noProgress.value).toBe('triggered')
    expect(noProgress.tone).toBe('fail')
    // and nothing else claims to have fired
    expect(rows.filter(r => r.tone === 'fail')).toHaveLength(1)
  })

  it('surfaces a wall-clock stop on the wall-clock row', () => {
    const rows = ceilingRows({ ...base, stoppedReason: 'wall_clock' })
    expect(rows.find(r => r.key === 'Wall clock')!.tone).toBe('fail')
  })

  it('never silently swallows a stopped_reason it has no row for', () => {
    const rows = ceilingRows({ ...base, stoppedReason: 'schema_unavailable' })
    const extra = rows.find(r => r.key === 'Stopped by')!
    expect(extra.value).toBe('schema_unavailable')
    expect(extra.tone).toBe('fail')
  })

  it('renders a null limitUsd as dormant, which is what lib/agent-budget.ts means by it', () => {
    const rows = ceilingRows(base)
    const dollar = rows.find(r => r.key === 'Dollar budget')!
    expect(dollar.value).toBe('dormant — no limit set')
    expect(dollar.tone).toBe('dormant')
    expect(dollar.value).not.toContain('$0.00')
  })

  it('renders a configured limitUsd as the real number and period', () => {
    const rows = ceilingRows({ ...base, budget: { ...BUDGET, limitUsd: 5, period: 'daily' } })
    expect(rows.find(r => r.key === 'Dollar budget')!.value).toBe('$5.00 per daily')
  })

  it('labels the limits that are NOT measurements of this run', () => {
    const rows = ceilingRows(base)
    expect(rows.find(r => r.key === 'Concurrency (per agent)')!.value).toBe('1 run max')
    expect(rows.find(r => r.key === 'Concurrency (per agent)')!.note).toContain('not recorded per run')
    expect(rows.find(r => r.key === 'Runs per 24h')!.value).toBe('20 max')
  })

  it('measures an unfinished run to now, and says so', () => {
    const rows = ceilingRows({
      ...base,
      completedAt: null,
      now: new Date('2026-08-26T00:10:00.000Z').getTime(),
    })
    const wall = rows.find(r => r.key === 'Wall clock')!
    expect(wall.value).toBe('10m 0s / 60m')
    expect(wall.note).toContain('has not completed')
  })

  it('warns when a finished run exceeded the ceiling without being stopped', () => {
    const rows = ceilingRows({ ...base, completedAt: '2026-08-26T02:00:00.000Z' })
    expect(rows.find(r => r.key === 'Wall clock')!.tone).toBe('warn')
  })
})

describe('ceilingSourceNote — a default is never displayed as a configured value', () => {
  it('names defaults as defaults', () => {
    expect(ceilingSourceNote('default')).toContain('defaults')
    expect(ceilingSourceNote('default')).toContain('not configured values')
  })
  it('names an unmigrated ceiling schema as unverifiable', () => {
    expect(ceilingSourceNote('unavailable')).toContain('UNVERIFIABLE')
  })
  it('names a real row as a real row', () => {
    expect(ceilingSourceNote('row')).toContain('agent_budgets row')
  })
})

// ─── the empty ──────────────────────────────────────────────────────────────

describe('NO_STEPS_MESSAGE', () => {
  it('says, verbatim, that no steps were recorded for this run', () => {
    expect(NO_STEPS_MESSAGE).toContain('no steps were recorded for this run')
  })

  it('does not imply the run did nothing', () => {
    expect(NO_STEPS_MESSAGE).toContain('agent_runs row is real')
  })
})

// ─── three-fabrications #2 ──────────────────────────────────────────────────
//
// `runTouchedPaidProvider` was named for the provider column and answered
// from the cost column: `steps.some(s => s.cost_usd !== null)`. MEASURED: a
// step with `provider = 'anthropic'` and `cost_usd = NULL` rendered
//
//     no step recorded a dollar cost (run_steps.cost_usd is null for all 1
//     step), so no dollar column is shown. The dollar column appears only
//     when a run touches a paid provider.
//
// while the row it described said `anthropic`. `run_steps.provider` was
// validated, stored, returned by the API, and read by nothing.

describe('the provider column is READ, not just stored', () => {
  const PROVIDER_NO_COST: RunStepRow[] = [
    step({ step_no: 1, tool: 'anthropic', what: 'asked the model', tokens: 1200, provider: 'anthropic' }),
  ]

  it('a step naming a provider with a null cost still opens the dollar column', () => {
    // FAILS against the old cost-only predicate, which answered false here
    // and hid the column over a row that says "anthropic".
    expect(runTouchedProvider(PROVIDER_NO_COST)).toBe(true)
  })

  it('is still FALSE when no step names a provider AND none records a cost', () => {
    expect(runTouchedProvider(LOCAL_RUN)).toBe(false)
  })

  it('renders that step as "cost not measured", naming the provider — not an em dash', () => {
    expect(formatStepCost(PROVIDER_NO_COST[0])).toBe('anthropic · cost not measured')
    // A step with neither is still an em dash, and a measured cost still wins.
    expect(formatStepCost(step({ step_no: 2 }))).toBe('—')
    expect(formatStepCost(step({ step_no: 3, provider: 'anthropic', cost_usd: 0.012 }))).toBe('$0.0120')
  })

  it('names the provider-only steps so the panel can say what is missing', () => {
    const out = costByStep([...PROVIDER_NO_COST, step({ step_no: 2, tool: 'read', tokens: 300 })])
    expect(out.stepsWithProviderNoCost).toBe(1)
    expect(out.providersWithoutCost).toEqual(['anthropic'])
  })
})

describe('the dollar total counts only the steps that recorded one', () => {
  // MEASURED: "$0.5000 across 3 steps" when ONE of three recorded a cost.
  const ONE_PAID: RunStepRow[] = [
    step({ step_no: 1, tool: 'anthropic', tokens: 500, cost_usd: 0.5 }),
    step({ step_no: 2, tool: 'read', tokens: 300 }),
    step({ step_no: 3, tool: 'edit', tokens: 200 }),
  ]

  it('reports how many steps the total is actually over', () => {
    const out = costByStep(ONE_PAID)
    expect(out.totalCostUsd).toBeCloseTo(0.5, 6)
    // The denominator the card prints. `3` here is the measured fabrication.
    expect(out.stepsWithCost).toBe(1)
    expect(out.stepsWithoutCost).toBe(2)
  })

  it('gives a run where every step recorded a cost no carve-out to make', () => {
    expect(costByStep(PAID_RUN).stepsWithoutCost).toBe(0)
    expect(costByStep(PAID_RUN).stepsWithCost).toBe(5)
  })
})

describe('a tool with a cost but no tokens does not vanish from the breakdown', () => {
  // `costByStep` filters its groups to `tokens > 0`, so this tool's bar never
  // renders while its dollars still land in totalCostUsd — the visible rows
  // sum to LESS than the printed total, with nothing on screen saying so.
  const MIXED: RunStepRow[] = [
    step({ step_no: 1, tool: 'read', tokens: 1000, cost_usd: 0.1 }),
    step({ step_no: 2, tool: 'image', tokens: null, cost_usd: 0.4 }),
  ]

  it('still draws no bar for it — a bar is a share of a token total it is not in', () => {
    const out = costByStep(MIXED)
    expect(out.groups.map(g => g.tool)).toEqual(['read'])
  })

  it('but NAMES it and its dollars, and says what the bars add up to', () => {
    const out = costByStep(MIXED)
    expect(out.costOnlyGroups).toEqual([{ tool: 'image', costUsd: 0.4, steps: 1 }])
    expect(out.barredCostUsd).toBeCloseTo(0.1, 6)
    expect(out.totalCostUsd).toBeCloseTo(0.5, 6)
    // The property the fix guarantees: what the bars show plus what is named
    // outside them equals the printed total.
    const named = (out.barredCostUsd ?? 0) + out.costOnlyGroups.reduce((s, g) => s + g.costUsd, 0)
    expect(named).toBeCloseTo(out.totalCostUsd ?? 0, 6)
  })

  it('has nothing to name on a run where every cost is already in a bar', () => {
    expect(costByStep(PAID_RUN).costOnlyGroups).toEqual([])
    expect(costByStep(LOCAL_RUN).costOnlyGroups).toEqual([])
    expect(costByStep(LOCAL_RUN).barredCostUsd).toBeNull()
  })
})
