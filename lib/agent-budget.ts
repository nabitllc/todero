// lib/agent-budget.ts — TOD-2381 (agent-budget-stop)
//
// Ceilings on a Todero-dispatched agent run, enforced by the SUPERVISOR — this
// module and its two call sites (POST /api/run-agent, PATCH /api/heartbeat) —
// never by the agent itself. See Mich-Brain2/Playbooks/Loop_Engineering.md:
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
//   3. no-progress  — halts BEFORE any other ceiling when state stops moving
//   4. run count    — bounds a self-retriggering loop directly
//   5. dollar spend — built and wired to the real ledger, but dormant until a
//                     run is routed to a paid provider (nullable limit_usd)
//
// Every check here is read-only against the agent_runs / token_ledger tables
// the dispatch path already writes — never an estimate, never a hardcoded
// number pretending to be telemetry.

import { db, DB_ERROR, type DbError } from '@/lib/db'
import { readHeartbeat } from '@/lib/agent-heartbeats'

// Same test as lib/db-http.ts's isMissingTableError, duplicated rather than
// imported: that file also exports Next route helpers built on `NextResponse`,
// which pulls in `next/server` — fine inside a route, but it means anything
// importing db-http.ts cannot be loaded from a plain Node script (CLI tooling,
// the demo in scripts/ that proves this piece's ceilings fire against the real
// database). This module has no other reason to depend on the Next runtime, so
// it keeps its own five-line copy instead.
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

// ── Defaults — used whenever no agent_budgets row exists yet, and whenever
// the table itself has not been migrated (same degrade-with-a-name pattern as
// lib/agent-heartbeats.ts, never a silent "no ceiling"). Overridable per host
// via env for operators who need different numbers before they touch the DB. ──
export const DEFAULT_MAX_CONCURRENT_PER_AGENT = Number(process.env.TODERO_MAX_CONCURRENT_PER_AGENT ?? 1)
export const DEFAULT_MAX_CONCURRENT_TOTAL = Number(process.env.TODERO_MAX_CONCURRENT_TOTAL ?? 4)
/** Wall-clock ceiling, ms. Default 60 minutes — checked on every heartbeat, not by the agent. */
export const DEFAULT_MAX_RUN_MS = Number(process.env.TODERO_MAX_RUN_MS ?? 60 * 60 * 1000)
/** Consecutive heartbeats with an unchanged issue state before a no-progress halt fires. */
export const DEFAULT_NO_PROGRESS_HEARTBEATS = Number(process.env.TODERO_NO_PROGRESS_HEARTBEATS ?? 3)
export const DEFAULT_MAX_RUNS_PER_PERIOD = Number(process.env.TODERO_MAX_RUNS_PER_PERIOD ?? 20)
/** Window a "run count per period" ceiling counts over. */
export const RUN_PERIOD_MS = 24 * 60 * 60 * 1000
/**
 * How old a `status='running'` agent_runs row can be and still count toward
 * concurrency. Generous on purpose — well past any real per-agent wall-clock
 * ceiling — so this is a dead-row filter, not a second wall clock. See the
 * comment at its one call site (checkDispatchCeilings) for why it exists.
 */
export const STALE_RUN_CUTOFF_MS = Number(process.env.TODERO_STALE_RUN_CUTOFF_MS ?? 6 * 60 * 60 * 1000)

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
  const { data: run, error } = await db()
    .from('agent_runs')
    .select('*')
    .eq('task_id', issue.id)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string; agent_id: string; started_at: string; pid: number | null
      stall_count: number; last_progress_hash: string | null
    }>()
  if (error || !run) return { allowed: true }

  const budget = await getAgentBudget(agentId)

  // ── 1. Wall clock — a run older than the ceiling is stopped outright, no
  // matter what it is doing. Enforced by the supervisor reading started_at,
  // not by anything the agent reports about itself. ──
  const ageMs = Date.now() - new Date(run.started_at).getTime()
  if (ageMs > budget.maxRunMs) {
    await stopRun(run.id, agentId, issue, run.pid, 'wall_clock',
      `run exceeded ${Math.round(budget.maxRunMs / 60000)} min wall clock (${Math.round(ageMs / 60000)} min elapsed)`,
      { ageMs, limitMs: budget.maxRunMs })
    return { allowed: false, ceiling: 'wall_clock', runId: run.id }
  }

  // ── 2. No-progress — fires BEFORE the dollar/run-count ceilings would ever
  // trip, per Loop_Engineering: "the cheap signal that catches a dead end
  // early". `issue.updated_at` unchanged across N heartbeats means nothing
  // about the task moved between beats. ──
  const hash = issue.updated_at
  const stalled = run.last_progress_hash === hash
  const nextStallCount = stalled ? (run.stall_count ?? 0) + 1 : 0

  if (stalled && nextStallCount >= budget.noProgressHeartbeats) {
    await stopRun(run.id, agentId, issue, run.pid, 'no_progress',
      `${nextStallCount} consecutive heartbeats with no change to the issue — this is the signal that would have caught the self-kicking watcher`,
      { stallCount: nextStallCount, limit: budget.noProgressHeartbeats })
    return { allowed: false, ceiling: 'no_progress', runId: run.id }
  }

  // Persist the (possibly reset) stall tracker — best-effort, never blocks the beat.
  const progressUpdate: Record<string, unknown> = {
    stall_count: nextStallCount,
    last_progress_hash: hash,
  }
  if (!stalled) progressUpdate.last_progress_at = new Date().toISOString()
  const { error: progressError } = await db().from('agent_runs').update(progressUpdate).eq('id', run.id)
  if (progressError) {
    console.warn(`[agent-budget] stall-tracker update failed (${progressError.message}) — no-progress detection degrades to "never trips" until migrations/038_agent_budgets_and_ceilings.sql is applied.`)
  }

  return { allowed: true, runId: run.id }
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
  // shows up wherever that one already does.
  await db().from('issues').update({
    is_blocked: true,
    blocked_by: `system:ceiling_stop:${ceiling}`,
    updated_at: now,
  }).eq('id', issue.id)

  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Different host, already dead, or no permission — the row is stopped
      // either way; this is a best-effort courtesy signal, not the guard itself.
    }
  }

  await recordCeilingEvent(agentId, ceiling, reason, detail, issue.task_key)
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
        message: `Agent '${agentId}' stopped by the ${ceiling} ceiling: ${reason}`,
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
