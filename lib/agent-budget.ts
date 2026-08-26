// lib/agent-budget.ts — TOD-2381 (agent-budget-stop)
//
// Ceilings on a Todero-dispatched agent run, enforced by the SUPERVISOR, never
// by the agent itself. See Mich-Brain2/Playbooks/Loop_Engineering.md:
// "Both guards were instructions the loop was free to reason past; neither was
// enforced by anything outside it. Treat a prompt-level stop condition as
// documentation of intent, never as a control."
//
// Todero targets a local model on this host, so a dollar ceiling is close to
// useless today — a run costs GPU time and wall clock, not money. The ceiling
// that actually matters here is the one lib/dispatch-guard.ts's own comment
// names: a detached watcher that keeps re-spawning. So the order below is
// deliberate, per the piece brief:
//   1. concurrency  — a hard cap on simultaneous runs, per agent and overall
//   2. wall clock   — a maximum run duration, checked on every heartbeat
//   3. no-progress  — the cheap early signal, when state stops moving
//   4. run count    — bounds a self-retriggering loop directly
//
// That list is an ORDER OF IMPORTANCE, not the order of the `if`s, and it used
// to say no-progress "halts BEFORE any other ceiling", which is not true of the
// code and is not what was meant. What is true: 1 and 4 are evaluated
// before a run starts (evaluateCeilings) while 2 and 3 apply to a run already
// in flight (evaluateRunCeilings), so they are never in the same comparison at
// all; and within the in-flight pair the wall clock is tested first, because a
// run past its hard time limit should stop for the plain reason rather than
// for a derived one. No-progress still fires FIRST IN TIME on a real stall —
// N observations plus DEFAULT_NO_PROGRESS_MIN_MS is minutes, the wall clock is
// an hour — which is the property the ordering was arguing for. Reorder the
// `if`s only with a reason; do not reorder them to match this list.
//   5. dollar spend — built and wired to the real ledger, but dormant until a
//                     run is routed to a paid provider (nullable limit_usd)
//
// Every check here is read-only against the agent_runs / token_ledger tables
// the dispatch path already writes — never an estimate, never a hardcoded
// number pretending to be telemetry.
//
// ── WHERE THESE ACTUALLY RUN, as of pieces9/run-safety-ceilings ─────────────
// This header used to say "its two call sites (POST /api/run-agent, PATCH
// /api/heartbeat)". That was a claim about reachability, and half of it was
// false in the configuration this repo ships. The honest list:
//
//   checkDispatchCeilings  <- POST /api/run-agent:440. UNREACHABLE while
//        TODERO_DISPATCH_ENABLED is off: that route answers 503
//        DISPATCH_DISABLED at :384, sixty lines earlier (measured today,
//        `POST /api/run-agent {"agent_id":"builder"}` -> HTTP 503). So
//        concurrency_per_agent, concurrency_total, run_count_period,
//        dollar_budget, schema_unavailable and read_error have never refused
//        a real dispatch on this host. They EVALUATE correctly against real
//        rows — that is proven — they just have nothing to refuse yet.
//   checkInFlightCeilings  <- PATCH /api/heartbeat:97. Real, and wall_clock
//        and no_progress have both been observed firing through it. But it
//        only runs inside a request THE AGENT CHOSE TO MAKE, which means the
//        one failure mode lib/dispatch-guard.ts names by name — a detached
//        watcher that stops beating — was structurally exempt from it.
//   sweepInFlightCeilings  <- POST /api/heartbeat/sweep, and (seam, see
//        lib/__tests__/agent-budget-sweep-seam.test.ts) /api/cron/watchdog.
//        Same evaluation, on a supervisor timer, for every running row in
//        the window whether or not a beat arrived. This is the trigger that
//        makes "enforced by the supervisor" true of a silent agent too.
//
// Keep this list honest. A comment asserting a call site that cannot execute
// is the same defect class as a ceiling that cannot fire.

import { db, DB_ERROR, type DbError } from '@/lib/db'

// Same test as lib/db-http.ts's isMissingTableError, duplicated rather than
// imported: that file also exports Next route helpers built on `NextResponse`,
// which pulls in `next/server` — fine inside a route, but it means anything
// importing db-http.ts cannot be loaded outside the Next runtime. That is not
// hypothetical: lib/__tests__/agent-budget-ceilings.test.ts drives this module
// directly under Jest's `node` test environment against a real file-backed
// SQLite built from migrations/sqlite/*.sql, with no Next server involved.
//
// The previous version of this comment justified the duplication by pointing
// at "the demo in scripts/ that proves this piece's ceilings fire against the
// real database". NO SUCH SCRIPT EXISTS OR EVER EXISTED — checked today with
// `ls scripts/`, `grep -rn ceiling scripts/`, and `git log --all --name-only
// -- scripts/`. A comment that cites imaginary evidence for a real decision is
// a defect even when the decision is right. The decision is right; the reason
// above is one you can run.
function isMissingTableError(error: DbError | null | undefined): boolean {
  if (!error) return false
  if (error.code === DB_ERROR.UNDEFINED_TABLE) return true
  return /schema cache/i.test(error.message) || /relation .* does not exist/i.test(error.message) || /could not find the table/i.test(error.message)
}

/** Same idea as {@link isMissingTableError}, for a column ADD COLUMN never ran. */
function isMissingColumnError(error: DbError | null | undefined): boolean {
  if (!error) return false
  if (error.code === DB_ERROR.UNDEFINED_COLUMN) return true
  return /column .* does not exist/i.test(error.message)
}

// ── Schema availability — the honesty gate ──────────────────────────────────
//
// TOD-2381 round 3: a critic found that on this repo's own hosted instance
// migrations/038_agent_budgets_and_ceilings.sql was never applied — agent_budgets
// does not exist and agent_runs never got pid/stall_count/last_progress_hash/
// stopped_reason — so PATCH /api/agents/{id}/budget 500s and, worse, the
// no-progress halt (this piece's own headline ceiling) can never fire: the
// column it hashes against does not exist, so `stalled` is always false. Before
// this, getAgentBudget/checkDispatchCeilings degraded straight to the built-in
// defaults on a missing table — which LOOKS like every ceiling is armed when
// one of them structurally cannot be. That is the same shape of dishonesty as
// the deleted /api/heartbeat/budget-check endpoint, one layer down.
//
// So: probe once (cached briefly — this is on the hot path of every dispatch
// and every roster poll), and if either piece of schema is missing, the whole
// budget system reports itself UNAVAILABLE rather than quietly running with
// one ceiling dead. checkDispatchCeilings then fails CLOSED on unavailable
// schema — no run starts — because "some ceilings enforced, others silently
// inert" is worse than "nothing runs until the operator migrates or reads
// knownGaps". checkInFlightCeilings (the heartbeat-time check on a run already
// in flight) is deliberately NOT gated the same way: its wall-clock ceiling
// already degrades gracefully via stopRun()'s three-tier write and has been
// PROVEN to fire on this exact unmigrated schema (live inbox rows, TOD-2387 /
// TOD-614) — gating it here would only turn a working stop into a non-stop.
export interface SchemaAvailability {
  available: boolean
  /** Empty when available. Named pieces, not a boolean, so the reason is legible. */
  missing: string[]
  checkedAt: number
}

let schemaCache: SchemaAvailability | null = null
/** Short TTL: cheap enough to re-check often, long enough not to hammer the DB
 * on a roster poll that asks for N agents' ceiling status in one request. */
const SCHEMA_CHECK_TTL_MS = 30_000

export async function checkBudgetSchema(): Promise<SchemaAvailability> {
  if (schemaCache && Date.now() - schemaCache.checkedAt < SCHEMA_CHECK_TTL_MS) return schemaCache
  const missing: string[] = []
  try {
    const [budgetsProbe, runsProbe] = await Promise.all([
      db().from('agent_budgets').select('agent_id').limit(1),
      db().from('agent_runs').select('id,pid,stall_count,last_progress_hash,stopped_reason').limit(1),
    ])
    if (budgetsProbe.error && isMissingTableError(budgetsProbe.error)) missing.push('agent_budgets')
    if (runsProbe.error && (isMissingTableError(runsProbe.error) || isMissingColumnError(runsProbe.error))) {
      missing.push('agent_runs.pid/stall_count/last_progress_hash/stopped_reason')
    }
  } catch (err) {
    // A network/config failure here is not "unmigrated" — it is "unreachable".
    // Report it as missing anyway (fail closed either way) but name it honestly.
    missing.push(`schema probe failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  const result: SchemaAvailability = { available: missing.length === 0, missing, checkedAt: Date.now() }
  schemaCache = result
  return result
}

/**
 * Last observed heartbeat for one agent, in epoch ms — or null when no beat
 * has ever landed for it. Deliberately NOT `import`ed from
 * lib/agent-heartbeats.ts: that module pulls in lib/agent-registrations.ts,
 * which pulls in lib/db-http.ts, which pulls in `next/server` — exactly the
 * dependency `isMissingTableError` above is duplicated to avoid. This is the
 * same duplication trade for the same reason, reading the identical two
 * stores lib/agent-heartbeats.ts writes (`agent_heartbeats`, falling back to
 * `agent_memory` under key `'heartbeat'`) so it sees the same beat that
 * route recorded.
 */
async function lastHeartbeatMs(agentId: string): Promise<number | null> {
  try {
    const { data, error } = await db()
      .from('agent_heartbeats')
      .select('last_seen')
      .eq('agent_id', agentId)
      .maybeSingle<{ last_seen: string | number }>()
    if (!error) {
      if (data?.last_seen == null) return null
      const ms = typeof data.last_seen === 'number' ? data.last_seen : new Date(data.last_seen).getTime()
      return Number.isFinite(ms) ? ms : null
    }
    if (!isMissingTableError(error)) return null
  } catch {
    // fall through to the pre-migration store
  }
  try {
    const { data, error } = await db()
      .from('agent_memory')
      .select('value')
      .eq('agent_id', agentId)
      .eq('key', 'heartbeat')
      .maybeSingle<{ value: unknown }>()
    if (error || !data) return null
    let parsed: unknown = data.value
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        return null
      }
    }
    if (!parsed || typeof parsed !== 'object') return null
    const lastSeen = (parsed as Record<string, unknown>).last_seen
    if (typeof lastSeen !== 'string' && typeof lastSeen !== 'number') return null
    const ms = typeof lastSeen === 'number' ? lastSeen : new Date(lastSeen).getTime()
    return Number.isFinite(ms) ? ms : null
  } catch {
    return null
  }
}

// ── Defaults — used whenever no agent_budgets row exists yet, and whenever
// the table itself has not been migrated (same degrade-with-a-name pattern as
// lib/agent-heartbeats.ts, never a silent "no ceiling"). Overridable per host
// via env for operators who need different numbers before they touch the DB. ──
//
// Every one of these used to be a bare `Number(process.env.X ?? default)`, and
// that is a way to disarm a ceiling by TYPO, with no code change and nothing
// said. Measured on this host before this helper existed:
//   TODERO_MAX_RUN_MS=1h            -> Number('1h') is NaN, and the wall-clock
//                                      test `ageMs > NaN` is false for every
//                                      ageMs, forever. Ceiling gone.
//   TODERO_NO_PROGRESS_HEARTBEATS=three -> `count >= NaN` is false, forever.
// The budget panel then renders the NaN as JSON `null`, so the UI shows "no
// limit" and calls it configuration. A ceiling that a plausible .env typo
// silently removes is not a ceiling. The DB-backed lever has an accidental
// backstop for the same class of mistake (SQLite's NOT NULL rejects a NaN
// write with HTTP 500) — the env path had none.
//
// So: parse strictly. Anything that is not a finite number > 0 is REFUSED,
// the built-in default is used instead, and the refusal is recorded in
// {@link ceilingConfigProblems} so a caller can show it rather than pretend
// the operator's value took effect. Refusing to a working ceiling is the
// fail-closed direction; NaN was the fail-open one.
const ceilingConfigProblemList: string[] = []

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const problem =
      `${name}=${JSON.stringify(raw)} is not a positive number — ignoring it and using the built-in ` +
      `default ${fallback}. Left as-is this would have disarmed the ceiling it configures (every ` +
      `comparison against NaN is false), silently.`
    ceilingConfigProblemList.push(problem)
    console.warn(`[agent-budget] ${problem}`)
    return fallback
  }
  return parsed
}

/**
 * Ceiling env vars this process refused to honour, in the operator's own
 * words. Empty on a correctly configured host. Exported so a status endpoint
 * or panel can SAY the value was rejected instead of showing a null that
 * reads like "no limit configured".
 */
export function ceilingConfigProblems(): string[] {
  return [...ceilingConfigProblemList]
}

export const DEFAULT_MAX_CONCURRENT_PER_AGENT = positiveIntFromEnv('TODERO_MAX_CONCURRENT_PER_AGENT', 1)
export const DEFAULT_MAX_CONCURRENT_TOTAL = positiveIntFromEnv('TODERO_MAX_CONCURRENT_TOTAL', 4)
/** Wall-clock ceiling, ms. Default 60 minutes — checked on every heartbeat, not by the agent. */
export const DEFAULT_MAX_RUN_MS = positiveIntFromEnv('TODERO_MAX_RUN_MS', 60 * 60 * 1000)
/** Consecutive heartbeats with an unchanged issue state before a no-progress halt fires. */
export const DEFAULT_NO_PROGRESS_HEARTBEATS = positiveIntFromEnv('TODERO_NO_PROGRESS_HEARTBEATS', 3)
/**
 * Floor on how long a run must ACTUALLY have been stalled before the
 * no-progress halt fires, independent of how many observations landed.
 *
 * Measured before this existed: four heartbeats arriving inside 218 ms
 * stopped a run for "3 consecutive heartbeats with no change". The counter
 * counts REQUESTS, so a chatty agent was killed in a quarter of a second
 * while a silent one — the detached watcher this whole module exists to
 * bound — was never killed at all, because it never made the request that
 * did the counting. The count alone was measuring talkativeness, not stall.
 *
 * Both halves are now fixed: this floor removes the false positive, and
 * {@link sweepInFlightCeilings} removes the false negative by making the
 * observations arrive on a supervisor timer instead of on the agent's own
 * traffic. Set to 0 to restore the pure count-based behaviour.
 */
export const DEFAULT_NO_PROGRESS_MIN_MS = (() => {
  const raw = process.env.TODERO_NO_PROGRESS_MIN_MS
  if (raw === '0') return 0
  return positiveIntFromEnv('TODERO_NO_PROGRESS_MIN_MS', 10 * 60 * 1000)
})()
export const DEFAULT_MAX_RUNS_PER_PERIOD = positiveIntFromEnv('TODERO_MAX_RUNS_PER_PERIOD', 20)
/** Window a "run count per period" ceiling counts over. */
export const RUN_PERIOD_MS = 24 * 60 * 60 * 1000
/**
 * How old a `status='running'` agent_runs row can be and still count toward
 * concurrency. Generous on purpose — well past any real per-agent wall-clock
 * ceiling — so this is a dead-row filter, not a second wall clock. See the
 * comment at its one call site (checkDispatchCeilings) for why it exists.
 */
export const STALE_RUN_CUTOFF_MS = positiveIntFromEnv('TODERO_STALE_RUN_CUTOFF_MS', 6 * 60 * 60 * 1000)

export interface AgentBudget {
  agentId: string
  period: 'run' | 'daily' | 'monthly'
  /** null = no dollar ceiling set (dormant, per the piece brief — not the only guard). */
  limitUsd: number | null
  maxConcurrentPerAgent: number
  maxRunMs: number
  noProgressHeartbeats: number
  maxRunsPerPeriod: number
  /**
   * 'row' when a real agent_budgets row answered, 'default' when the table
   * exists but this agent has none, 'unavailable' when the schema itself is
   * unmigrated on this database — never silently "default" for that case,
   * per {@link checkBudgetSchema}'s doc comment.
   */
  source: 'row' | 'default' | 'unavailable'
}

let budgetsTableMissingWarned = false

/**
 * One agent's ceilings — a real row if agent_budgets has one, built-in
 * defaults otherwise, or `source:'unavailable'` when the migration this
 * whole system depends on has never been applied to this database. See
 * {@link checkBudgetSchema}: this deliberately does NOT quietly return
 * `source:'default'` for that case, because the no-progress ceiling those
 * defaults imply is armed is actually dead on a database missing
 * agent_runs.last_progress_hash — an unavailable ceiling reported as a
 * default one is the exact dishonesty this piece exists to remove.
 */
export async function getAgentBudget(agentId: string): Promise<AgentBudget> {
  const schema = await checkBudgetSchema()
  const defaults: AgentBudget = {
    agentId,
    period: 'daily',
    limitUsd: null,
    maxConcurrentPerAgent: DEFAULT_MAX_CONCURRENT_PER_AGENT,
    maxRunMs: DEFAULT_MAX_RUN_MS,
    noProgressHeartbeats: DEFAULT_NO_PROGRESS_HEARTBEATS,
    maxRunsPerPeriod: DEFAULT_MAX_RUNS_PER_PERIOD,
    source: schema.available ? 'default' : 'unavailable',
  }
  if (!schema.available) return defaults
  try {
    const { data, error } = await db()
      .from('agent_budgets')
      .select('*')
      .eq('agent_id', agentId)
      .maybeSingle<{
        agent_id: string
        period: 'run' | 'daily' | 'monthly'
        limit_usd: number | null
        max_concurrent_runs: number
        max_run_ms: number
        no_progress_heartbeats: number
        max_runs_per_period: number
      }>()
    if (error) {
      if (!isMissingTableError(error)) {
        console.warn(`[agent-budget] read failed for ${agentId}: ${error.message}`)
      } else if (!budgetsTableMissingWarned) {
        budgetsTableMissingWarned = true
        console.warn('[agent-budget] agent_budgets table not found — run migrations/038_agent_budgets_and_ceilings.sql. Falling back to built-in defaults; subsequent warnings suppressed.')
      }
      return defaults
    }
    if (!data) return defaults
    return {
      agentId,
      period: data.period ?? 'daily',
      limitUsd: data.limit_usd ?? null,
      maxConcurrentPerAgent: data.max_concurrent_runs ?? DEFAULT_MAX_CONCURRENT_PER_AGENT,
      maxRunMs: data.max_run_ms ?? DEFAULT_MAX_RUN_MS,
      noProgressHeartbeats: data.no_progress_heartbeats ?? DEFAULT_NO_PROGRESS_HEARTBEATS,
      maxRunsPerPeriod: data.max_runs_per_period ?? DEFAULT_MAX_RUNS_PER_PERIOD,
      source: 'row',
    }
  } catch (err) {
    console.warn(`[agent-budget] ${err instanceof Error ? err.message : String(err)}`)
    return defaults
  }
}

/** Upsert one agent's ceilings. Only the fields present in `patch` change. */
export async function setAgentBudget(agentId: string, patch: Partial<{
  period: 'run' | 'daily' | 'monthly'
  limitUsd: number | null
  maxConcurrentPerAgent: number
  maxRunMs: number
  noProgressHeartbeats: number
  maxRunsPerPeriod: number
}>): Promise<{ ok: boolean; error?: string }> {
  const current = await getAgentBudget(agentId)
  const row = {
    agent_id: agentId,
    period: patch.period ?? current.period,
    limit_usd: patch.limitUsd !== undefined ? patch.limitUsd : current.limitUsd,
    max_concurrent_runs: patch.maxConcurrentPerAgent ?? current.maxConcurrentPerAgent,
    max_run_ms: patch.maxRunMs ?? current.maxRunMs,
    no_progress_heartbeats: patch.noProgressHeartbeats ?? current.noProgressHeartbeats,
    max_runs_per_period: patch.maxRunsPerPeriod ?? current.maxRunsPerPeriod,
    updated_at: new Date().toISOString(),
  }
  const { error } = await db().from('agent_budgets').upsert(row)
  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, error: 'agent_budgets table not found — run migrations/038_agent_budgets_and_ceilings.sql' }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Real spend-to-date for one agent within `sinceIso`, summed from closed
 * token_ledger rows. Throws rather than returning 0 on a read error — a
 * failed read is not the same fact as "no spend", and a budget ceiling that
 * cannot tell those apart is exactly the arithmetic bug this piece replaced
 * (the old /api/heartbeat/budget-check comparison that could never fire).
 * token_ledger predates this piece (migration 008) so a missing-table error
 * here means something is actually wrong, not merely unmigrated.
 */
export async function getSpendUsd(agentId: string, sinceIso: string): Promise<number> {
  const { data, error } = await db()
    .from('token_ledger')
    .select('cost_usd')
    .eq('agent_id', agentId)
    .gte('spawned_at', sinceIso)
  if (error) throw new Error(`getSpendUsd read failed: ${error.message}`)
  return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
}

/** Real run count for one agent within `sinceIso`, counted from token_ledger spawns. Throws on a read error — see {@link getSpendUsd}. */
async function getRunCount(agentId: string, sinceIso: string): Promise<number> {
  const { data, error } = await db()
    .from('token_ledger')
    .select('id')
    .eq('agent_id', agentId)
    .gte('spawned_at', sinceIso)
  if (error) throw new Error(`getRunCount read failed: ${error.message}`)
  return (data ?? []).length
}

function periodStartIso(period: 'run' | 'daily' | 'monthly'): string {
  const now = new Date()
  if (period === 'monthly') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  if (period === 'run') return new Date(now.getTime() - RUN_PERIOD_MS).toISOString()
  // daily
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
}

export type CeilingName =
  | 'concurrency_per_agent'
  | 'concurrency_total'
  | 'run_count_period'
  | 'dollar_budget'
  | 'wall_clock'
  | 'no_progress'
  /** The migration this whole module depends on has not been applied — see {@link checkBudgetSchema}. */
  | 'schema_unavailable'
  /** A ledger read that should have succeeded (token_ledger predates this piece) errored instead of returning data. */
  | 'read_error'

export interface CeilingResult {
  allowed: boolean
  ceiling?: CeilingName
  reason?: string
  detail?: Record<string, unknown>
}

/**
 * The actual ceiling logic, with NO side effects — no inbox write, no
 * agent_memory write. Two callers need the same verdict for different
 * reasons: {@link checkDispatchCeilings} acts on it (and records the event
 * when it denies), while {@link getCeilingStatus} only displays it (the
 * roster GET and the budget GET both poll this, and polling must never be
 * what fills the inbox with ceiling_stop rows).
 */
async function evaluateCeilings(agentId: string): Promise<CeilingResult> {
  // Fail CLOSED when the schema this whole module depends on is missing —
  // see checkBudgetSchema's doc comment. Deliberately checked before
  // anything else: a partially-armed ceiling set reported as fully armed is
  // the dishonesty this piece exists to remove, so "cannot verify" denies
  // rather than degrading to defaults.
  const schema = await checkBudgetSchema()
  if (!schema.available) {
    return {
      allowed: false,
      ceiling: 'schema_unavailable',
      reason: `ceiling schema not migrated on this database (missing: ${schema.missing.join('; ')}) — refusing to dispatch rather than run with a ceiling (no-progress) that cannot be verified. Run migrations/038_agent_budgets_and_ceilings.sql, or set DATABASE_URL so boot-migrate applies it automatically on the next server start.`,
      detail: { missing: schema.missing },
    }
  }

  const budget = await getAgentBudget(agentId)

  // "Running" only counts a row started within a sane recency window. Without
  // this, a concurrency ceiling reading agent_runs.status='running' verbatim
  // is exactly the ledger-never-closes bug this piece exists to fix, one
  // table over: this host's agent_runs currently carries 67,592 rows stuck at
  // status='running' (the app/api/issues/route.ts close-on-status-change path
  // only fires for issues that changed status — a crashed or abandoned run
  // never does). Counting all of them as "currently occupying a slot" would
  // make the ceiling permanently deny every dispatch, for the wrong reason,
  // forever — a guard that never opens is as dishonest as one that never
  // closes. A row past this cutoff should already have been stopped by the
  // heartbeat-time wall-clock check; if it wasn't (heartbeats stopped
  // arriving — a crash), it is stale, not concurrent, and does not count.
  const staleCutoff = new Date(Date.now() - STALE_RUN_CUTOFF_MS).toISOString()
  const [{ data: runningForAgent }, { data: runningTotal }] = await Promise.all([
    db().from('agent_runs').select('id').eq('agent_id', agentId).eq('status', 'running').gte('started_at', staleCutoff),
    db().from('agent_runs').select('id').eq('status', 'running').gte('started_at', staleCutoff),
  ])
  const perAgent = (runningForAgent ?? []).length
  const total = (runningTotal ?? []).length

  if (perAgent >= budget.maxConcurrentPerAgent) {
    return {
      allowed: false, ceiling: 'concurrency_per_agent',
      reason: `${perAgent}/${budget.maxConcurrentPerAgent} runs already in flight for ${agentId}`,
      detail: { running: perAgent, limit: budget.maxConcurrentPerAgent },
    }
  }
  if (total >= DEFAULT_MAX_CONCURRENT_TOTAL) {
    return {
      allowed: false, ceiling: 'concurrency_total',
      reason: `${total}/${DEFAULT_MAX_CONCURRENT_TOTAL} runs already in flight across all agents`,
      detail: { running: total, limit: DEFAULT_MAX_CONCURRENT_TOTAL },
    }
  }

  // getRunCount/getSpendUsd now throw on a genuine read error rather than
  // returning 0 (see their doc comments) — a 0 there used to be
  // indistinguishable from real zero spend/runs, which is the same
  // arithmetic dishonesty this piece deleted from /api/heartbeat/budget-check.
  // Caught here and turned into a fail-closed denial: a run-count or spend
  // ceiling that cannot be evaluated must not silently pass.
  const runPeriodSince = new Date(Date.now() - RUN_PERIOD_MS).toISOString()
  let runCount: number
  try {
    runCount = await getRunCount(agentId, runPeriodSince)
  } catch (err) {
    return {
      allowed: false, ceiling: 'read_error',
      reason: `could not read ${agentId}'s run count from token_ledger: ${err instanceof Error ? err.message : String(err)}`,
      detail: { source: 'getRunCount' },
    }
  }
  if (runCount >= budget.maxRunsPerPeriod) {
    return {
      allowed: false, ceiling: 'run_count_period',
      reason: `${runCount}/${budget.maxRunsPerPeriod} runs already spawned in the last 24h — this is the ceiling that bounds a self-retriggering loop`,
      detail: { runCount, limit: budget.maxRunsPerPeriod, windowMs: RUN_PERIOD_MS },
    }
  }

  if (budget.limitUsd != null) {
    const since = periodStartIso(budget.period)
    let spend: number
    try {
      spend = await getSpendUsd(agentId, since)
    } catch (err) {
      return {
        allowed: false, ceiling: 'read_error',
        reason: `could not read ${agentId}'s spend from token_ledger: ${err instanceof Error ? err.message : String(err)}`,
        detail: { source: 'getSpendUsd' },
      }
    }
    if (spend >= budget.limitUsd) {
      return {
        allowed: false, ceiling: 'dollar_budget',
        reason: `$${spend.toFixed(4)} spent of a $${budget.limitUsd.toFixed(2)} ${budget.period} budget`,
        detail: { spendUsd: spend, limitUsd: budget.limitUsd, period: budget.period },
      }
    }
  }

  return { allowed: true }
}

/**
 * Called from the dispatch path (POST /api/run-agent) BEFORE a run starts.
 * Never asks the agent anything — every number here comes from agent_runs /
 * token_ledger rows the server itself already wrote. Unlike
 * {@link getCeilingStatus}, a denial here is recorded (inbox + agent_memory)
 * because this call means a real dispatch was actually refused.
 */
export async function checkDispatchCeilings(agentId: string): Promise<CeilingResult> {
  const result = await evaluateCeilings(agentId)
  if (!result.allowed && result.ceiling) {
    await recordCeilingEvent(agentId, result.ceiling, result.reason ?? '', result.detail ?? {}, null)
  }
  return result
}

/**
 * Read-only status check for display — the roster (GET /api/agents) and the
 * per-agent budget panel (GET /api/agents/{id}/budget) both call this to show
 * an "over ceiling" flag. Deliberately does NOT call {@link recordCeilingEvent}:
 * a dashboard poll must never be what fills the inbox with ceiling_stop rows.
 */
export async function getCeilingStatus(agentId: string): Promise<CeilingResult> {
  return evaluateCeilings(agentId)
}

/**
 * Called from PATCH /api/heartbeat on every beat of a run already in flight.
 * `issue` carries the mutable state the no-progress check hashes on —
 * `updated_at` is enough: any real edit to the row (status, notes, fields)
 * moves it, and a stalled agent that touches nothing does not.
 */
export async function checkInFlightCeilings(
  agentId: string,
  issue: { id: string; task_key: string | null; updated_at: string },
): Promise<CeilingResult & { runId?: string }> {
  // Same dead-row filter checkDispatchCeilings applies to its concurrency
  // counts, and for the identical reason: without it, a `status='running'`
  // row that was never closed (this host has 67,591 of them, 0 started in
  // the last 6h) reads as an active run forever. Before this filter, ANY
  // ordinary heartbeat for an issue with a zombie run row underneath it
  // computed ageMs from a started_at months old, tripped the wall-clock
  // ceiling, and blocked a live issue off a dead process — measured doing
  // exactly that to TOD-614 from one normal beat. A row past this cutoff is
  // not "a run to stop", it is a row nobody ever closed; `!run` below then
  // returns allowed:true instead of inventing a stop for it.
  const staleCutoff = new Date(Date.now() - STALE_RUN_CUTOFF_MS).toISOString()
  const { data: run, error } = await db()
    .from('agent_runs')
    .select('*')
    .eq('task_id', issue.id)
    .eq('status', 'running')
    .gte('started_at', staleCutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<InFlightRun>()
  if (error || !run) return { allowed: true }

  return evaluateRunCeilings(agentId, run, issue, { requireRecentHeartbeat: true })
}

/** One `status='running'` row, in the shape both in-flight callers read it. */
interface InFlightRun {
  id: string
  agent_id: string
  started_at: string
  pid: number | null
  stall_count: number
  last_progress_hash: string | null
  last_progress_at?: string | null
}

interface InFlightOptions {
  /**
   * When true (the heartbeat path), a wall-clock stop additionally requires a
   * heartbeat observed inside STALE_RUN_CUTOFF_MS. See the long note at the
   * wall-clock branch for why the two callers differ here — it is the whole
   * reason a detached watcher used to be exempt from every ceiling.
   */
  requireRecentHeartbeat: boolean
  /** Where the observation came from, for the inbox reason line. */
  source?: 'heartbeat' | 'sweep'
}

/**
 * The in-flight ceilings — wall clock, then no-progress — applied to ONE run
 * row against ONE issue's mutable state. Shared verbatim by the two triggers
 * so they can never drift into enforcing different rules:
 *   - {@link checkInFlightCeilings}, driven by the agent's own heartbeat
 *   - {@link sweepInFlightCeilings}, driven by a supervisor timer
 */
async function evaluateRunCeilings(
  agentId: string,
  run: InFlightRun,
  issue: { id: string; task_key: string | null; updated_at: string },
  opts: InFlightOptions,
): Promise<CeilingResult & { runId?: string }> {
  const budget = await getAgentBudget(agentId)
  const source = opts.source ?? 'heartbeat'

  // ── 1. Wall clock — a run older than the ceiling is stopped outright, no
  // matter what it is doing. Enforced by the supervisor reading started_at,
  // not by anything the agent reports about itself.
  //
  // The heartbeat trigger additionally requires a recent beat before it will
  // stop, because there the started_at cutoff alone does not prove the agent
  // is alive: an ordinary beat for an issue carrying a zombie run row used to
  // compute ageMs from a started_at months old and block a live issue off a
  // dead process (measured doing exactly that to TOD-614). Note this makes
  // the guard nearly vacuous on that path — the route records the beat BEFORE
  // calling in, so `lastHeartbeatMs(owner)` is by construction seconds old.
  //
  // The SWEEP trigger deliberately does not require it, and that difference
  // is the point of this piece. A run past its wall clock with NO beat is not
  // an ambiguous row — it is precisely the detached, self-respawning watcher
  // lib/dispatch-guard.ts's comment names, and "no beat" was the exact
  // property that made it immune. The 6h started_at cutoff still bounds what
  // the sweep will touch, and the beat age is recorded in the stop detail so
  // the inbox row says which case it was rather than leaving it to be
  // inferred. ──
  const ageMs = Date.now() - new Date(run.started_at).getTime()
  if (ageMs > budget.maxRunMs) {
    const lastBeatMs = await lastHeartbeatMs(agentId)
    const beatAgeMs = lastBeatMs === null ? null : Date.now() - lastBeatMs
    const heartbeatRecent = beatAgeMs !== null && beatAgeMs < STALE_RUN_CUTOFF_MS
    if (opts.requireRecentHeartbeat && !heartbeatRecent) {
      return { allowed: true, runId: run.id }
    }
    const beatPhrase = beatAgeMs === null
      ? ' and has never sent a heartbeat'
      : heartbeatRecent
        ? ''
        : ` and has not sent a heartbeat in ${Math.round(beatAgeMs / 60000)} min`
    await stopRun(run.id, agentId, issue, run.pid, 'wall_clock',
      `run exceeded ${Math.round(budget.maxRunMs / 60000)} min wall clock (${Math.round(ageMs / 60000)} min elapsed)${beatPhrase}`,
      { ageMs, limitMs: budget.maxRunMs, beatAgeMs, heartbeatRecent, source })
    return { allowed: false, ceiling: 'wall_clock', runId: run.id }
  }

  // ── 2. No-progress — fires BEFORE the dollar/run-count ceilings would ever
  // trip, per Loop_Engineering: "the cheap signal that catches a dead end
  // early". `issue.updated_at` unchanged across N observations means nothing
  // about the task moved between them.
  //
  // Two conditions, not one: N consecutive stalled observations AND at least
  // DEFAULT_NO_PROGRESS_MIN_MS of real elapsed stall. The count alone was
  // measuring how CHATTY an agent is — four beats inside 218 ms tripped a
  // "3 consecutive heartbeats" halt, measured. See that constant's comment. ──
  const hash = issue.updated_at
  const stalled = run.last_progress_hash === hash
  const nextStallCount = stalled ? (run.stall_count ?? 0) + 1 : 0
  const now = new Date().toISOString()

  // Persist the tracker BEFORE deciding to stop. It used to be written only on
  // the non-stopping path, so a stopped run's persisted stall_count was one
  // behind the number its own inbox reason quoted — the row said 2 while the
  // message said 3 (measured). Two numbers for one fact, and the durable one
  // was the wrong one.
  const progressUpdate: Record<string, unknown> = {
    stall_count: nextStallCount,
    last_progress_hash: hash,
  }
  if (!stalled) progressUpdate.last_progress_at = now
  const { error: progressError } = await db().from('agent_runs').update(progressUpdate).eq('id', run.id)
  if (progressError) {
    console.warn(`[agent-budget] stall-tracker update failed (${progressError.message}) — no-progress detection degrades to "never trips" until migrations/038_agent_budgets_and_ceilings.sql is applied.`)
  }

  if (stalled && nextStallCount >= budget.noProgressHeartbeats) {
    // Elapsed stall is measured from the last observation that SAW progress,
    // falling back to the run's own start when the column was never written
    // (pre-038 host, or a run that has never once moved).
    const stallSince = run.last_progress_at ?? run.started_at
    const stalledForMs = Date.now() - new Date(stallSince).getTime()
    if (!Number.isFinite(stalledForMs) || stalledForMs >= DEFAULT_NO_PROGRESS_MIN_MS) {
      await stopRun(run.id, agentId, issue, run.pid, 'no_progress',
        `${nextStallCount} consecutive checks with no change to the issue over ${Math.round(stalledForMs / 60000)} min — this is the signal that would have caught the self-kicking watcher`,
        {
          stallCount: nextStallCount, limit: budget.noProgressHeartbeats,
          stalledForMs, minStallMs: DEFAULT_NO_PROGRESS_MIN_MS, source,
        })
      return { allowed: false, ceiling: 'no_progress', runId: run.id }
    }
  }

  return { allowed: true, runId: run.id }
}

/**
 * How many running rows one sweep will look at. A bound, not a guess: this
 * host's agent_runs carries ~67,600 rows stuck at status='running' (the
 * close-on-status-change path only fires for issues that changed status, so a
 * crashed run never closes). The started_at window below excludes essentially
 * all of them, but a sweep that could in principle walk the whole table on a
 * timer is a denial-of-service the supervisor points at itself.
 */
export const SWEEP_BATCH_LIMIT = positiveIntFromEnv('TODERO_CEILING_SWEEP_LIMIT', 50)

export interface SweepStop {
  runId: string
  agentId: string
  taskKey: string | null
  ceiling: CeilingName
}

export interface SweepResult {
  /** Running rows inside the window that were actually evaluated. */
  scanned: number
  stopped: SweepStop[]
  /** Rows skipped because their issue row could not be read (deleted, or no task_id). */
  skipped: number
  errors: string[]
}

/**
 * THE SUPERVISOR-SIDE TRIGGER. Evaluate the in-flight ceilings for every
 * `status='running'` row inside the staleness window, regardless of whether
 * that run's agent sent a heartbeat.
 *
 * Why this exists at all: before it, `checkInFlightCeilings` had exactly one
 * call site in the repo — inside PATCH /api/heartbeat — so the only two
 * ceilings that stop anything ran only inside a request the agent CHOSE to
 * make. An agent that stopped beating was never stopped and its pid was never
 * signalled. That is not a corner case; it is the precise behaviour of the
 * detached self-respawning watcher lib/dispatch-guard.ts's own comment names
 * as the threat this module was built for. "Enforced by the supervisor" is
 * only true once the supervisor can act without the agent's cooperation.
 *
 * Same evaluation, same stop, same inbox row as the heartbeat path — see
 * {@link evaluateRunCeilings}. The only difference is `requireRecentHeartbeat`,
 * and that difference is argued at the wall-clock branch.
 *
 * Idempotent and safe to run on a short timer: a run it stops is no longer
 * `status='running'`, so the next sweep does not see it.
 */
export async function sweepInFlightCeilings(opts?: { limit?: number }): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, stopped: [], skipped: 0, errors: [] }
  const limit = opts?.limit ?? SWEEP_BATCH_LIMIT

  const staleCutoff = new Date(Date.now() - STALE_RUN_CUTOFF_MS).toISOString()
  const { data: runs, error } = await db()
    .from('agent_runs')
    .select('id,agent_id,task_id,started_at,pid,stall_count,last_progress_hash,last_progress_at')
    .eq('status', 'running')
    .gte('started_at', staleCutoff)
    .order('started_at', { ascending: true })
    .limit(limit)

  if (error) {
    result.errors.push(`agent_runs read failed: ${error.message}`)
    return result
  }

  for (const run of (runs ?? []) as Array<InFlightRun & { task_id: string | null }>) {
    if (!run.task_id) {
      result.skipped++
      continue
    }
    const { data: issueRow, error: issueError } = await db()
      .from('issues')
      .select('id,task_key,updated_at')
      .eq('id', run.task_id)
      .maybeSingle<{ id: string; task_key: string | null; updated_at: string }>()
    if (issueError || !issueRow) {
      // A running row whose issue is gone cannot be evaluated for no-progress
      // (there is no state to hash) and must not be invented a stop for.
      // Counted, not swallowed, so a sweep that skips everything says so.
      result.skipped++
      if (issueError) result.errors.push(`issue read failed for run ${run.id}: ${issueError.message}`)
      continue
    }
    result.scanned++
    try {
      const verdict = await evaluateRunCeilings(run.agent_id, run, issueRow, {
        requireRecentHeartbeat: false,
        source: 'sweep',
      })
      if (!verdict.allowed && verdict.ceiling) {
        result.stopped.push({
          runId: run.id, agentId: run.agent_id,
          taskKey: issueRow.task_key, ceiling: verdict.ceiling,
        })
      }
    } catch (err) {
      // One bad row must not abort the sweep for every other run.
      result.errors.push(`run ${run.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

/**
 * Stop an in-flight run outside the agent: mark the ledger row, revert the
 * issue for human triage, and — best-effort, same-host only — send the
 * process a real signal rather than merely disowning it in the database.
 */
async function stopRun(
  runId: string, agentId: string,
  issue: { id: string; task_key: string | null },
  pid: number | null,
  ceiling: CeilingName, reason: string, detail: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString()

  // Three tiers, each degrading to what the host's actual schema will accept.
  // The enforcement already happened by the time this runs (the caller
  // already returned allowed:false) — every tier here is only about how
  // completely the stop gets RECORDED, and the one thing that must not
  // happen is the row silently staying 'running' forever (which would then
  // wrongly occupy a concurrency slot). Tier 1 needs
  // migrations/038_agent_budgets_and_ceilings.sql applied (stopped_reason /
  // stopped_at columns, and 'stopped' added to the status CHECK). Tier 2
  // degrades for a host with the new columns but an unmigrated CHECK
  // constraint. Tier 3 is for THIS repo's own hosted dev instance as found:
  // an undocumented, drifted CHECK constraint (predating any migration file)
  // that only accepts 'running' | 'failed' | 'done' — see the migration's
  // comment for how that was discovered.
  const tiers: Array<Record<string, unknown>> = [
    { status: 'stopped', stopped_reason: ceiling, stopped_at: now, finished_at: now },
    { status: 'stopped', finished_at: now },
    { status: 'failed', finished_at: now },
  ]
  for (let i = 0; i < tiers.length; i++) {
    const { error } = await db().from('agent_runs').update(tiers[i]).eq('id', runId)
    if (!error) break
    if (i === tiers.length - 1) {
      console.warn(`[agent-budget] agent_runs update failed on every fallback tier, last error: ${error.message}. This run is stopped and observable via inbox/issues, but its agent_runs row could not be updated at all.`)
    } else {
      console.warn(`[agent-budget] agent_runs update tier ${i + 1} failed (${error.message}) — trying tier ${i + 2}. Run migrations/038_agent_budgets_and_ceilings.sql for full ceiling-stop bookkeeping.`)
    }
  }

  // Revert the issue to a state a human (or the main agent) triages — the
  // same shape lib/loop-breaker.ts uses for a paused agent, so this halt
  // shows up wherever that one already does. Checked: the run row above is
  // already marked stopped by this point, so a failure here specifically
  // means the dispatch-gating block never landed — the issue looks stopped
  // in agent_runs but stays pickable by the dispatcher. That must be logged
  // as a failed stop, not swallowed as if the ceiling worked cleanly.
  const { error: blockError } = await db().from('issues').update({
    is_blocked: true,
    blocked_by: `system:ceiling_stop:${ceiling}`,
    updated_at: now,
  }).eq('id', issue.id)
  if (blockError) {
    console.warn(`[agent-budget] ceiling stop '${ceiling}' for agent '${agentId}' could NOT set issues.is_blocked on ${issue.task_key ?? issue.id} (${blockError.message}) — the run is marked stopped but the issue remains dispatchable. Treat this as a FAILED stop, not a silent one.`)
  }

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Different host, already dead, or no permission — the row is stopped
      // either way; this is a best-effort courtesy signal, not the guard itself.
    }
  }

  await recordCeilingEvent(
    agentId, ceiling, reason,
    { ...detail, issue_blocked: !blockError, ...(blockError ? { issue_block_error: blockError.message } : {}) },
    issue.task_key,
  )
}

/**
 * Make the stop observable (piece brief #4: "a silent stop is nearly as bad
 * as no stop"). Writes an inbox entry an operator sees, and an agent_memory
 * marker so any roster reader can show the reason without re-deriving it.
 * Both are best-effort — a failed write here must never mask the stop that
 * already happened in agent_runs/issues above.
 */
async function recordCeilingEvent(
  agentId: string, ceiling: CeilingName, reason: string,
  detail: Record<string, unknown>, taskKey: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await db().from('inbox').insert({
      agent: agentId,
      type: 'ceiling_stop',
      context: {
        agent_id: agentId,
        ceiling,
        reason,
        detail,
        task_key: taskKey,
        halted_at: now,
        message: detail.issue_blocked === false
          ? `Agent '${agentId}' stopped by the ${ceiling} ceiling: ${reason} — FAILED to mark the issue is_blocked (${String(detail.issue_block_error ?? 'unknown error')}); it is still dispatchable.`
          : `Agent '${agentId}' stopped by the ${ceiling} ceiling: ${reason}`,
      },
      status: 'pending',
    })
  } catch (err) {
    console.warn(`[agent-budget] inbox write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    // onConflict is load-bearing: agent_memory's real uniqueness is
    // UNIQUE(agent_id, key), not its `id` primary key (see the identical
    // note in lib/loop-breaker.ts's writeMemoryValue). Without it the seam
    // defaults to `id`, which this payload never supplies, so the row never
    // actually merges — it silently INSERTs a duplicate every call, with no
    // thrown error to catch here.
    const { error } = await db().from('agent_memory').upsert({
      agent_id: agentId,
      key: 'ceiling_stop',
      value: { ceiling, reason, detail, task_key: taskKey, at: now },
      updated_at: now,
    }, { onConflict: 'agent_id,key' })
    if (error) {
      console.warn(`[agent-budget] agent_memory write failed: ${error.message}`)
    }
  } catch (err) {
    console.warn(`[agent-budget] agent_memory write failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
