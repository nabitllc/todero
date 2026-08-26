// lib/run-trace.ts — runs-traces piece (Run Safety & Enforcement)
//
// Every number design/Run.dc.html's trace shows is computed HERE, from a
// `run_steps` column (migration 060) or an `agent_runs` column. Nothing in
// this file has a literal step, a literal cost, or a literal ceiling in it.
// That is the whole point: components/nav/RunsView.tsx shipped honestly
// refusing to draw a per-step breakdown because no table backed one, and the
// fix for that is the missing data plus one place that derives from it — not a
// component with an array of plausible-looking rows pasted into its body.
//
// This module is deliberately PURE:
//   - no `lib/db` import, so it loads in the jest node environment with no
//     database and no adapter resolution
//   - no `next/server` import, so a 'use client' component can call it
//   - no React import, so the validator can run inside the API route
// The route and the card therefore share one definition of what a step is,
// what a percentage means, and when a dollar column may appear.

// ─── The row ────────────────────────────────────────────────────────────────

/**
 * One `run_steps` row as the app uses it. `tokens`, `duration_ms`, `cost_usd`
 * and `provider` are nullable BECAUSE THE COLUMN IS: a step whose token count
 * was never measured must render `—`, and a step that never touched a paid
 * provider must not contribute a `$0.00`. See migrations/060_run_steps.sql.
 */
export interface RunStepRow {
  id: string
  run_id: string
  step_no: number
  tool: string
  what: string
  detail: string | null
  tokens: number | null
  duration_ms: number | null
  ok: boolean
  cost_usd: number | null
  provider: string | null
  created_at: string
}

/** The run-level columns this module reads. A subset of `agent_runs`. */
export interface RunHeaderRow {
  id: string
  agent_id: string
  task_id: string | null
  task_title: string | null
  status: string
  started_at: string
  completed_at: string | null
  tokens_used: number | null
  cost_usd: number | null
  stopped_reason: string | null
  error: string | null
}

/**
 * The exact sentence a run with zero recorded steps shows. Lowercase and
 * verbatim on purpose — the piece brief requires this wording, and an empty
 * table or a "nothing here" in its place would imply the run did nothing.
 */
export const NO_STEPS_MESSAGE =
  'no steps were recorded for this run — the agent_runs row is real, but nothing wrote a step to run_steps for it, so there is nothing to trace.'

// ─── Reading: normalising what an adapter hands back ────────────────────────
//
// sqlite has no boolean type, so `ok` comes back as 0/1 there and as a real
// boolean on Postgres (lib/db/sqlite-adapter.ts vs lib/db/pg-adapter.ts).
// `cost_usd` is `numeric` on Postgres, which some drivers hand back as a
// string to avoid float loss. Both are normalised once, here, rather than
// defended against at every render site.

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value)
  return s.length === 0 ? null : s
}

/** Turn one raw adapter row into a {@link RunStepRow}. */
export function normalizeStepRow(raw: Record<string, unknown>): RunStepRow {
  return {
    id: String(raw.id ?? ''),
    run_id: String(raw.run_id ?? ''),
    step_no: Number(raw.step_no ?? 0),
    tool: String(raw.tool ?? ''),
    what: String(raw.what ?? ''),
    detail: asStringOrNull(raw.detail),
    tokens: asNumberOrNull(raw.tokens),
    duration_ms: asNumberOrNull(raw.duration_ms),
    // Only an explicit falsey marker makes a step failed. `undefined` (a row
    // read before the column existed) is NOT "failed" — it is unknown, and
    // the column's own default is true.
    ok: raw.ok === undefined || raw.ok === null ? true : !(raw.ok === false || raw.ok === 0 || raw.ok === '0'),
    cost_usd: asNumberOrNull(raw.cost_usd),
    provider: asStringOrNull(raw.provider),
    created_at: String(raw.created_at ?? ''),
  }
}

// ─── Writing: fail-closed validation ────────────────────────────────────────
//
// Same stance as app/api/hub-settings/route.ts: an unknown key is a typo or an
// injection, never a feature, so it is REFUSED rather than stored or silently
// dropped. A trace is evidence; a trace that quietly absorbed a field it did
// not understand is evidence nobody can audit.

/** Every key `POST /api/run-steps` accepts. Anything else is a 400. */
export const STEP_WRITE_KEYS = [
  'run_id',
  'step_no',
  'tool',
  'what',
  'detail',
  'tokens',
  'duration_ms',
  'ok',
  'cost_usd',
  'provider',
] as const

export type StepWriteKey = (typeof STEP_WRITE_KEYS)[number]

/** A validated, normalised step ready to be inserted. */
export interface StepWrite {
  run_id: string
  step_no: number
  tool: string
  what: string
  detail: string | null
  tokens: number | null
  duration_ms: number | null
  ok: boolean
  cost_usd: number | null
  provider: string | null
}

export type StepWriteVerdict =
  | { ok: true; value: StepWrite }
  | { ok: false; why: string; status: 400 | 422 }

function requiredText(raw: unknown, field: string, max: number): { ok: true; value: string } | { ok: false; why: string } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, why: `${field} is required and must be a non-empty string` }
  }
  if (raw.length > max) return { ok: false, why: `${field} must be ${max} characters or fewer` }
  return { ok: true, value: raw.trim() }
}

function optionalText(raw: unknown, field: string, max: number): { ok: true; value: string | null } | { ok: false; why: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, why: `${field} must be a string or null` }
  if (raw.length > max) return { ok: false, why: `${field} must be ${max} characters or fewer` }
  return { ok: true, value: raw }
}

function optionalNonNegativeInt(raw: unknown, field: string): { ok: true; value: number | null } | { ok: false; why: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 0) return { ok: false, why: `${field} must be a whole number of 0 or more, or null` }
  return { ok: true, value: n }
}

/**
 * Validate one POST body. Unknown key -> 400 (fail closed). Known key with a
 * value the column cannot honestly hold -> 422.
 */
export function validateStepWrite(body: unknown): StepWriteVerdict {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, why: 'body must be a JSON object', status: 400 }
  }
  const known = new Set<string>(STEP_WRITE_KEYS)
  for (const key of Object.keys(body as Record<string, unknown>)) {
    if (!known.has(key)) {
      return {
        ok: false,
        status: 400,
        why: `unknown field "${key}" — known fields: ${STEP_WRITE_KEYS.join(', ')}`,
      }
    }
  }

  const b = body as Record<string, unknown>

  const runId = requiredText(b.run_id, 'run_id', 200)
  if (!runId.ok) return { ok: false, why: runId.why, status: 422 }

  const stepNoRaw = b.step_no
  const stepNo = typeof stepNoRaw === 'number' ? stepNoRaw : Number(stepNoRaw)
  if (!Number.isInteger(stepNo) || stepNo < 1) {
    // 1-based on purpose — the trace renders "01" as the first step, and a
    // step 0 would sort ahead of it with no meaning attached.
    return { ok: false, why: 'step_no must be a whole number of 1 or more', status: 422 }
  }

  const tool = requiredText(b.tool, 'tool', 80)
  if (!tool.ok) return { ok: false, why: tool.why, status: 422 }

  const what = requiredText(b.what, 'what', 500)
  if (!what.ok) return { ok: false, why: what.why, status: 422 }

  const detail = optionalText(b.detail, 'detail', 2000)
  if (!detail.ok) return { ok: false, why: detail.why, status: 422 }

  const tokens = optionalNonNegativeInt(b.tokens, 'tokens')
  if (!tokens.ok) return { ok: false, why: tokens.why, status: 422 }

  const durationMs = optionalNonNegativeInt(b.duration_ms, 'duration_ms')
  if (!durationMs.ok) return { ok: false, why: durationMs.why, status: 422 }

  if (b.ok !== undefined && typeof b.ok !== 'boolean') {
    return { ok: false, why: 'ok must be true or false', status: 422 }
  }

  // cost_usd is the column the dollar column keys off. Omitting it (or
  // sending null) is how a recorder says "this step cost no money that anyone
  // measured" — which is NOT the same as $0.00 and must not be normalised
  // into one. See migrations/060_run_steps.sql.
  let costUsd: number | null = null
  if (b.cost_usd !== undefined && b.cost_usd !== null && b.cost_usd !== '') {
    const n = typeof b.cost_usd === 'number' ? b.cost_usd : Number(b.cost_usd)
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, why: 'cost_usd must be a number of 0 or more, or null for a step that touched no paid provider', status: 422 }
    }
    costUsd = n
  }

  const provider = optionalText(b.provider, 'provider', 120)
  if (!provider.ok) return { ok: false, why: provider.why, status: 422 }

  return {
    ok: true,
    value: {
      run_id: runId.value,
      step_no: stepNo,
      tool: tool.value,
      what: what.value,
      detail: detail.value,
      tokens: tokens.value,
      duration_ms: durationMs.value,
      ok: b.ok === undefined ? true : (b.ok as boolean),
      cost_usd: costUsd,
      provider: provider.value,
    },
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────
//
// One rule runs through all three: a null renders as an em dash, never as a
// zero. `0` on screen is a measurement; `—` is the absence of one, and the
// operator must be able to tell them apart at a glance.

/** `null` -> `'—'`. Never `'0'`. */
export function formatTokens(tokens: number | null): string {
  if (tokens === null) return '—'
  if (tokens < 1000) return String(tokens)
  return `${(tokens / 1000).toFixed(1)}k`
}

/** `null` -> `'—'`. `340ms` / `18.4s` / `4m 51s`. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

/** A ceiling expressed in ms — `60m` when whole, otherwise {@link formatMs}. */
export function formatLimitMs(ms: number): string {
  if (ms > 0 && ms % 60_000 === 0) return `${ms / 60_000}m`
  return formatMs(ms)
}

/** `null` -> `'—'`. Never `'$0.00'` for an unrecorded cost. */
export function formatUsd(usd: number | null): string {
  if (usd === null) return '—'
  if (usd !== 0 && Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** `1` -> `'01'`, matching design/Run.dc.html's step gutter. */
export function formatStepNo(stepNo: number): string {
  return String(stepNo).padStart(2, '0')
}

// ─── The dollar column's condition ──────────────────────────────────────────

/**
 * design/Run.dc.html: "The dollar column appears only when a run touches a
 * paid provider."
 *
 * The condition is a column, not a guess: TRUE as soon as one step carries a
 * non-null `cost_usd` — INCLUDING a recorded 0, which is a real measurement of
 * a paid provider that charged nothing (a cache hit). FALSE when every step's
 * cost is null, which is what a local model on this host actually writes.
 */
export function runTouchedPaidProvider(steps: readonly RunStepRow[]): boolean {
  return steps.some(s => s.cost_usd !== null)
}

// ─── Cost by step ───────────────────────────────────────────────────────────

export interface CostGroup {
  /** The recorded `tool` string. Never a hand-written phase name mapped onto it. */
  tool: string
  tokens: number
  /** Whole percent of the run's recorded token total. The groups sum to 100. */
  pct: number
  /** Summed `cost_usd`, or null when no step in this group recorded one. */
  costUsd: number | null
  steps: number
}

export interface CostBreakdown {
  groups: CostGroup[]
  /** Sum of every recorded `tokens`. 0 when nothing recorded one. */
  totalTokens: number
  /** Steps whose `tokens` column is null — named, never counted as zero. */
  stepsWithoutTokens: number
  totalCostUsd: number | null
}

/**
 * Group the run's steps by tool and turn recorded tokens into percentages.
 *
 * When NOTHING recorded a token count this returns no groups at all rather
 * than one 100% bucket over a zero — a full-width bar drawn from no data is
 * exactly the fabrication this piece exists to prevent, and the caller renders
 * the absence in words instead.
 *
 * Percentages use the largest-remainder method so they sum to exactly 100
 * whenever there is at least one group; rounding each share independently can
 * drift several points away from 100 across many groups.
 */
export function costByStep(steps: readonly RunStepRow[]): CostBreakdown {
  const stepsWithoutTokens = steps.filter(s => s.tokens === null).length
  const totalCostUsd = steps.some(s => s.cost_usd !== null)
    ? steps.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0)
    : null

  const byTool = new Map<string, { tokens: number; costUsd: number | null; steps: number }>()
  for (const s of steps) {
    const entry = byTool.get(s.tool) ?? { tokens: 0, costUsd: null, steps: 0 }
    entry.steps += 1
    if (s.tokens !== null) entry.tokens += s.tokens
    if (s.cost_usd !== null) entry.costUsd = (entry.costUsd ?? 0) + s.cost_usd
    byTool.set(s.tool, entry)
  }

  const totalTokens = [...byTool.values()].reduce((sum, e) => sum + e.tokens, 0)
  if (totalTokens === 0) {
    return { groups: [], totalTokens: 0, stepsWithoutTokens, totalCostUsd }
  }

  const raw = [...byTool.entries()]
    .filter(([, e]) => e.tokens > 0)
    .map(([tool, e]) => ({
      tool,
      tokens: e.tokens,
      costUsd: e.costUsd,
      steps: e.steps,
      exact: (e.tokens / totalTokens) * 100,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.tool.localeCompare(b.tool))

  const floors = raw.map(r => Math.floor(r.exact))
  let remainder = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] += 1
    remainder -= 1
  }

  return {
    groups: raw.map((r, i) => ({ tool: r.tool, tokens: r.tokens, pct: floors[i], costUsd: r.costUsd, steps: r.steps })),
    totalTokens,
    stepsWithoutTokens,
    totalCostUsd,
  }
}

// ─── Run totals ─────────────────────────────────────────────────────────────

export interface TraceTotals {
  steps: number
  failedSteps: number
  /** null when NO step recorded a token count — not 0. */
  tokens: number | null
  /** null when NO step recorded a duration — not 0. */
  durationMs: number | null
  /** null when no step touched a paid provider. */
  costUsd: number | null
}

export function traceTotals(steps: readonly RunStepRow[]): TraceTotals {
  const withTokens = steps.filter(s => s.tokens !== null)
  const withDuration = steps.filter(s => s.duration_ms !== null)
  const withCost = steps.filter(s => s.cost_usd !== null)
  return {
    steps: steps.length,
    failedSteps: steps.filter(s => !s.ok).length,
    tokens: withTokens.length === 0 ? null : withTokens.reduce((sum, s) => sum + (s.tokens ?? 0), 0),
    durationMs: withDuration.length === 0 ? null : withDuration.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    costUsd: withCost.length === 0 ? null : withCost.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0),
  }
}

// ─── Ceilings ───────────────────────────────────────────────────────────────
//
// Every number below comes from GET /api/agents/<id>/budget, which is
// lib/agent-budget.ts's own `getAgentBudget` — the same values
// `checkDispatchCeilings` and `checkInFlightCeilings` enforce with. Nothing
// here invents a limit, and nothing here claims a ceiling fired unless
// `agent_runs.stopped_reason` names it (that column is written by
// lib/agent-budget.ts's `stopRun`, and by nothing else).

/** The `budget` object GET /api/agents/<id>/budget returns. */
export interface RunBudget {
  period: string
  limitUsd: number | null
  maxConcurrentPerAgent: number
  maxRunMs: number
  noProgressHeartbeats: number
  maxRunsPerPeriod: number
  source: 'row' | 'default' | 'unavailable'
}

export type CeilingTone = 'ok' | 'warn' | 'fail' | 'dormant'

export interface CeilingRow {
  key: string
  value: string
  /** Says where the number came from when it is not a measurement of THIS run. */
  note: string | null
  tone: CeilingTone
}

export interface CeilingInput {
  startedAt: string
  completedAt: string | null
  /** `agent_runs.stopped_reason` — a {@link CeilingRow} says "triggered" only from this. */
  stoppedReason: string | null
  budget: RunBudget
  /** Injected so the test does not race the clock. */
  now?: number
}

/**
 * Rows for the "Ceilings on this run" panel.
 *
 * Note the deliberate split: wall clock and the no-progress halt are facts
 * ABOUT THIS RUN (elapsed time from started_at/completed_at, and
 * stopped_reason). Concurrency and runs-per-period are not recorded per run
 * anywhere, so they are rendered as the LIMIT IN FORCE with a note saying so,
 * rather than as a live number dressed up as history.
 */
export function ceilingRows(input: CeilingInput): CeilingRow[] {
  const { budget, stoppedReason } = input
  const end = input.completedAt ? new Date(input.completedAt).getTime() : (input.now ?? Date.now())
  const elapsed = Math.max(0, end - new Date(input.startedAt).getTime())

  const wallTone: CeilingTone =
    stoppedReason === 'wall_clock' ? 'fail' : elapsed > budget.maxRunMs ? 'warn' : 'ok'

  const rows: CeilingRow[] = [
    {
      key: 'Wall clock',
      value: `${formatMs(elapsed)} / ${formatLimitMs(budget.maxRunMs)}`,
      note: input.completedAt ? null : 'run has not completed — elapsed is measured to now',
      tone: wallTone,
    },
    {
      key: 'No-progress halt',
      value: stoppedReason === 'no_progress' ? 'triggered' : 'not triggered',
      note: `halts after ${budget.noProgressHeartbeats} heartbeats with no change to the issue`,
      tone: stoppedReason === 'no_progress' ? 'fail' : 'ok',
    },
    {
      key: 'Concurrency (per agent)',
      value: `${budget.maxConcurrentPerAgent} run${budget.maxConcurrentPerAgent === 1 ? '' : 's'} max`,
      note: 'the limit in force — concurrency is not recorded per run',
      tone: stoppedReason === 'concurrency_per_agent' ? 'fail' : 'ok',
    },
    {
      key: 'Runs per 24h',
      value: `${budget.maxRunsPerPeriod} max`,
      note: 'the limit in force — not a measurement of this run',
      tone: stoppedReason === 'run_count_period' ? 'fail' : 'ok',
    },
    {
      key: 'Dollar budget',
      value: budget.limitUsd === null
        ? 'dormant — no limit set'
        : `${formatUsd(budget.limitUsd)} per ${budget.period}`,
      note: budget.limitUsd === null
        ? 'a null limit_usd is what lib/agent-budget.ts treats as no dollar ceiling'
        : null,
      tone: stoppedReason === 'dollar_budget' ? 'fail' : budget.limitUsd === null ? 'dormant' : 'ok',
    },
  ]

  // A ceiling stop this panel has no row for must still be visible — better a
  // row named after the raw column value than a stopped run that reads clean.
  const named = new Set(['wall_clock', 'no_progress', 'concurrency_per_agent', 'run_count_period', 'dollar_budget'])
  if (stoppedReason && !named.has(stoppedReason)) {
    rows.push({
      key: 'Stopped by',
      value: stoppedReason,
      note: 'agent_runs.stopped_reason — no dedicated row above covers this ceiling',
      tone: 'fail',
    })
  }

  return rows
}

/** One line naming where the ceilings above came from. */
export function ceilingSourceNote(source: RunBudget['source']): string {
  if (source === 'row') return 'limits from this agent’s agent_budgets row'
  if (source === 'default') return 'no agent_budgets row for this agent — these are lib/agent-budget.ts defaults, not configured values'
  return 'ceiling schema not migrated on this database — lib/agent-budget.ts reports these limits as UNVERIFIABLE, and dispatch fails closed'
}
