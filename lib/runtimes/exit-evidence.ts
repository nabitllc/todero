// pieces8/memory-attempted — the observable half of "what it TRIED".
//
// WHY THIS FILE EXISTS
//
// `recordRunOnExit()` (lib/memory-loop.ts) wrote `attempted: null`,
// `succeeded: false`, `exit_status: null` on EVERY row it has ever written.
// The stated reason — repeated in pieces7/memory-loop.md §8, and agreed by a
// critic — was that `watchChildExit()` only proves "the OS pid is gone", so
// there is nothing honest to fill in.
//
// That reasoning is correct about `watchChildExit` and WRONG about the exit
// moment as a whole. At the instant the adapters call `recordRunOnExit()`,
// the very same callback ALREADY reads real, structured outcome data out of
// the run's own log file and hands it to the token ledger:
//
//   * lib/runtimes/claude-code.ts  — `claude --print --output-format json`
//     writes one completion object carrying `subtype`
//     (`success` / `error_max_turns` / `error_during_execution`), `is_error`,
//     `num_turns`, `duration_ms` and the model's own final `result` text.
//     The adapter parses that object for tokens and cost, then throws
//     `subtype` / `is_error` / `result` away.
//   * lib/runtimes/openai-api.ts   — `parseOpenAiTrace()` returns a real
//     terminal `status` (`completed` / `failed` / `max_iterations` /
//     `running` / `unknown`) plus every `tool_call` step the run made. The
//     adapter passes `status` to `finalizeRun()` and throws the rest away.
//   * lib/runtimes/detached-spawn.ts — writes `[spawn-failure] …` lines into
//     the same log for a late spawn error, and (as of this piece) records the
//     child's REAL exit code / signal via `child.on('exit')`.
//
// So the honest fields were being computed and discarded, not "unobservable".
// This module is the one place that turns those already-observed facts into
// the three columns, and nothing here is ever inferred from data the run did
// not actually produce: every branch that has no evidence returns
// `'unknown'` and leaves `succeeded`/`failed` both false — exactly the
// pre-existing behaviour.
//
// WHAT `succeeded` / `failed` MEAN HERE — read this before trusting them.
// They mean *the run process reported success/failure*, never "the review
// passed" or "the task was actually done right". Review outcome is a later,
// separate fact that lands on the issue row (`rejection_count`,
// `last_rejection_reason`) and is already recorded alongside these columns.
// Every `attempted` string this module builds is provenance-stamped with the
// exact signals it was derived from so a reader — human or a later agent
// reading it back out of retrieval — can see which claim is which.
//
// SERVER ONLY: reads log files off disk.

import { readFileSync } from 'fs'

/**
 * A run's outcome as it can honestly be stated from what the exit moment
 * actually observed.
 *
 * - `succeeded` — the run's own terminal record says it finished cleanly, or
 *   (for a runtime that writes no terminal record) the OS reported exit 0.
 * - `failed`    — a non-zero exit / signal, a `[spawn-failure]` line, or the
 *   run's own terminal record saying it errored or ran out of turns.
 * - `unknown`   — nothing terminal was observed (the commonest case for a
 *   run whose watcher was lost to a server restart). Both boolean columns
 *   stay false, which is what they have always been.
 */
export type RunOutcome = 'succeeded' | 'failed' | 'unknown'

export interface RunExitEvidence {
  outcome: RunOutcome
  /** For `agent_run_records.succeeded`. */
  succeeded: boolean
  /** For `agent_run_records.failed`. */
  failed: boolean
  /** For `agent_run_records.exit_status` — the REAL OS code, or null when it was never observed. */
  exitStatus: number | null
  /**
   * For `agent_run_records.attempted` — a provenance-stamped record of what
   * the run actually did, built only from the facts passed in. `null` when
   * literally nothing was observed, so a row with no evidence still reads as
   * "no record", never as a fabricated one.
   */
  attempted: string | null
}

/**
 * Facts a caller genuinely observed at exit time. Every field is optional
 * because every runtime observes a different subset; an absent field means
 * "not observed", never "false"/"zero".
 */
export interface ObservedExitFacts {
  /** Adapter name, e.g. 'claude-code' — stamped into `attempted` as provenance. */
  runtime: string
  /** Real OS exit code from `child.on('exit')`, or null when never observed. */
  exitCode?: number | null
  /** Real terminating signal, or null. */
  signal?: string | null
  /** Wall-clock seconds between spawn and the exit being noticed. */
  durationSec?: number | null
  /** The terminal status word the run itself wrote (claude `subtype`, openai-api `run_end.status`). */
  reportedStatus?: string | null
  /** The run's own error flag (claude `is_error`). Undefined when the runtime states none. */
  reportedError?: boolean
  /** Turn / iteration count the run itself reported. */
  turns?: number | null
  /** Names of tools the run actually invoked, in order, as recorded by the run's own trace. */
  toolsUsed?: string[]
  tokensIn?: number | null
  tokensOut?: number | null
  /** The agent's own final message, verbatim. Its own claim — labelled as such in `attempted`. */
  finalReport?: string | null
  /** `[spawn-failure] …` lines found in the log. Any hit means the launch or the child errored. */
  spawnFailures?: string[]
  /**
   * Last few verbatim log lines, for a runtime that writes no structured
   * terminal record. Only used when nothing better exists — see
   * `readLogTail()`.
   */
  logTail?: string[]
  /** Where the full record lives, named in a truncation marker so nothing is silently lost. */
  logFile?: string
}

/** A run's own terminal word for "it finished the job". */
const SUCCESS_STATUSES = new Set(['success', 'completed', 'ok', 'done'])
/**
 * A status word that means "this run's own trace does NOT attest that it
 * finished" — `parseOpenAiTrace()` returns `'running'` when the last thing the
 * trace recorded was a step rather than a `run_end`, and `'unknown'` when the
 * trace was unreadable or empty (lib/runtimes/openai-api.ts:625, :640).
 *
 * Round 2 repair — read this before "simplifying" the branch that uses it.
 * These two used to fall through to the exit-0 fallback below, so
 * `summarizeExit({runtime:'openai-api', exitCode:0, reportedStatus:'running'})`
 * returned `succeeded: true` with an `attempted` string that read
 * `reported_status=running … outcome=succeeded` — a row asserting, on its own
 * face, both that the run never finished and that it succeeded. That is the
 * same fabricated-outcome class as the `max_iterations` case this module was
 * written to prevent, one branch over.
 *
 * The distinction that makes the fix safe: a status word that is PRESENT and
 * non-terminal is evidence ("the run wrote a trace, and that trace does not
 * say it finished"), whereas an ABSENT status is merely silence — codex and
 * cursor never write one, so for them exit 0 really is the only outcome
 * signal that exists and is still read as success.
 */
const NON_TERMINAL_STATUSES = new Set(['running', 'unknown'])

/**
 * Hard ceiling on the `attempted` string.
 *
 * This is NOT the "overflow errors, never truncates" rule bending: that rule
 * governs the RETRIEVAL budget, where silently dropping half a record makes
 * the surviving half read as the whole story. Here the opposite risk is the
 * live one — `attempted` is fed to both search engines and rendered by
 * `formatRecord()` inside a 1,300-token retrieval budget, so an unbounded log
 * tail on one row would make that single row exceed the budget on its own and
 * raise `RetrievalBudgetExceededError`, which
 * `app/api/run-agent/route.ts` now answers with a 503 (pieces7 §11c). A
 * bounded, explicitly-marked excerpt that names the log file holding the rest
 * is the honest trade; a silent one would not be.
 *
 * WHAT THIS CAP DOES *NOT* DO — round-2 correction of a false claim this
 * piece shipped. The original §9 of docs/rebuild/pieces/pieces8/
 * memory-attempted.md said 1,200 chars (~300 tokens) "keeps any single record
 * well under budget — RetrievalBudgetExceededError still cannot fire on one
 * row alone". That was untrue of the shipped code and is measured false:
 * `formatRecord()` (lib/memory-retrieval.ts) renders `attempted` ALONGSIDE
 * `rejectionReason` and `reviewerNotes`, and neither of those is capped
 * anywhere, by this piece or before it. A row with a 4,600-char
 * `reviewer_notes` and `attempted: null` already rendered at ~1,185 tokens;
 * the same row with `attempted` at exactly this cap rendered at ~1,468 and
 * threw. So this cap bounds only THIS piece's own contribution — it cannot
 * and does not make a record budget-safe on its own.
 *
 * The guard that actually keeps this piece from turning a working dispatch
 * into a 503 lives on the read side: `buildRetrievedContext()` gives this
 * excerpt back — clipped with an explicit marker, or omitted and disclosed —
 * before it will raise on the top-ranked record. See `refitAttemptedToBudget`
 * in lib/memory-retrieval.ts. Changing this number therefore changes how much
 * of `attempted` survives retrieval, never whether retrieval succeeds; it is
 * pinned by a test (lib/__tests__/exit-evidence.test.ts, "the cap is what
 * keeps one record's own excerpt inside the retrieval budget").
 */
export const ATTEMPTED_MAX_CHARS = 1_200
/** Per-line cap inside the log tail, so one enormous line cannot eat the whole budget. */
const TAIL_LINE_MAX_CHARS = 200
/** How many trailing log lines to keep when there is no structured record. */
const TAIL_LINES = 5
/** Cap on the agent's own final report — the most useful, and most verbose, single field. */
const FINAL_REPORT_MAX_CHARS = 700

/**
 * Decide `succeeded`/`failed`/`exit_status`/`attempted` from observed facts.
 *
 * Precedence, hardest evidence first. This list is checked against the code
 * below line by line — an earlier version of it claimed step 4 caught
 * `running`/`unknown` when the shipped code let both fall through to step 5,
 * so treat any edit here as an edit to the behaviour it describes:
 *   1. a `[spawn-failure]` line   → failed (the launch or the child errored)
 *   2. a terminating signal       → failed
 *   3. a non-zero exit code       → failed
 *   4. the run's own error flag   → failed
 *   5. a status word the run itself wrote, whatever the exit code:
 *        `running` / `unknown`    → unknown  (its trace does not attest completion)
 *        a success word           → succeeded
 *        anything else terminal   → failed   (`max_iterations`, `error_*`, …)
 *   6. NO status word at all, exit code 0 → succeeded ("the process reported
 *      success" — the only signal codex/cursor ever produce)
 *   7. nothing at all             → unknown, both columns false
 *
 * Step 5 sits ABOVE step 6 deliberately: a run that hits `max_iterations`
 * exits 0 while having plainly not finished, and reading that as a success is
 * the exact kind of fabricated-outcome claim this module exists to avoid.
 * `running`/`unknown` are inside step 5 for the same reason — see
 * `NON_TERMINAL_STATUSES`.
 */
export function summarizeExit(facts: ObservedExitFacts): RunExitEvidence {
  const exitStatus = typeof facts.exitCode === 'number' ? facts.exitCode : null
  const outcome = decideOutcome(facts, exitStatus)
  return {
    outcome,
    succeeded: outcome === 'succeeded',
    failed: outcome === 'failed',
    exitStatus,
    attempted: buildAttempted(facts, outcome, exitStatus),
  }
}

function decideOutcome(facts: ObservedExitFacts, exitStatus: number | null): RunOutcome {
  if (facts.spawnFailures && facts.spawnFailures.length > 0) return 'failed'
  if (facts.signal) return 'failed'
  if (exitStatus !== null && exitStatus !== 0) return 'failed'
  if (facts.reportedError === true) return 'failed'

  const status = (facts.reportedStatus ?? '').trim().toLowerCase()
  if (status) {
    // The run wrote a status word. It is evidence in both directions — and a
    // non-terminal one ('running'/'unknown') outranks a clean exit code,
    // because "the process left" and "the work finished" are different
    // claims and only the trace can speak to the second.
    if (NON_TERMINAL_STATUSES.has(status)) return 'unknown'
    return SUCCESS_STATUSES.has(status) ? 'succeeded' : 'failed'
  }
  // A run that wrote no terminal record is NOT a success just because its
  // process left cleanly — but for a runtime that never writes one at all
  // (codex, cursor), exit 0 is the only outcome signal that exists, and
  // saying "unknown" there would discard a real observation. The
  // distinction is preserved in `attempted`, which names exactly which
  // signal the verdict came from.
  if (exitStatus === 0) return 'succeeded'
  return 'unknown'
}

function buildAttempted(facts: ObservedExitFacts, outcome: RunOutcome, exitStatus: number | null): string | null {
  const header: string[] = [`runtime=${facts.runtime}`]
  header.push(`exit_code=${exitStatus === null ? 'not-observed' : String(exitStatus)}`)
  if (facts.signal) header.push(`signal=${facts.signal}`)
  if (typeof facts.durationSec === 'number') header.push(`duration_sec=${facts.durationSec}`)
  if (facts.reportedStatus) header.push(`reported_status=${facts.reportedStatus}`)
  if (typeof facts.reportedError === 'boolean') header.push(`reported_error=${facts.reportedError}`)
  if (typeof facts.turns === 'number') header.push(`turns=${facts.turns}`)
  if (typeof facts.tokensIn === 'number') header.push(`tokens_in=${facts.tokensIn}`)
  if (typeof facts.tokensOut === 'number') header.push(`tokens_out=${facts.tokensOut}`)
  header.push(`outcome=${outcome}`)

  const sections: string[] = [`[run-exit] ${header.join(' ')}`]

  // Everything below is EVIDENCE, each block naming where it came from.
  const hasStructuredRecord = Boolean(facts.reportedStatus) || typeof facts.reportedError === 'boolean'

  if (facts.spawnFailures && facts.spawnFailures.length > 0) {
    sections.push(`spawn failures (verbatim from the run log):\n${facts.spawnFailures.map(l => `  ${l.trim()}`).join('\n')}`)
  }

  // The one case where the two hardest signals disagree, spelled out rather
  // than left for a reader to reconcile from the header: the OS says the
  // process left cleanly, the run's own trace never said it finished. A later
  // agent retrieving this row needs to know which half is which.
  const reported = (facts.reportedStatus ?? '').trim().toLowerCase()
  if (outcome === 'unknown' && exitStatus === 0 && NON_TERMINAL_STATUSES.has(reported)) {
    sections.push(
      `the process exited 0, but the run's own trace never recorded a terminal status ` +
      `(last status: ${facts.reportedStatus}) — recorded as unknown, NOT as a success`,
    )
  }

  if (facts.toolsUsed && facts.toolsUsed.length > 0) {
    sections.push(`tools invoked (${facts.toolsUsed.length}, from the run's own trace): ${facts.toolsUsed.join(', ')}`)
  }

  const finalReport = (facts.finalReport ?? '').trim()
  if (finalReport) {
    sections.push(
      `agent's own final report (verbatim; the agent's claim about what it did, NOT a verified outcome):\n` +
      clip(finalReport, FINAL_REPORT_MAX_CHARS, facts.logFile),
    )
  }

  // A log tail is the ONLY evidence for a runtime that writes no structured
  // terminal record (codex / cursor today). It is deliberately not added on
  // top of a structured record, where it would be noise competing for the
  // same retrieval budget.
  if (!hasStructuredRecord && !finalReport && facts.logTail && facts.logTail.length > 0) {
    sections.push(
      `no structured completion record for this runtime — last ${facts.logTail.length} log line(s), verbatim:\n` +
      facts.logTail.map(l => `  ${clip(l.trim(), TAIL_LINE_MAX_CHARS)}`).join('\n'),
    )
  }

  // A header on its own is still a real observation ("the process exited 0
  // after 41s and reported nothing") — but a header with NO exit code, NO
  // duration and no evidence at all is not, and must stay null rather than
  // becoming a row that looks like it says something.
  if (sections.length === 1 && exitStatus === null && !facts.signal && typeof facts.durationSec !== 'number') {
    return null
  }

  return clip(sections.join('\n'), ATTEMPTED_MAX_CHARS, facts.logFile)
}

/** Truncate with an explicit marker that names where the untruncated text lives. */
function clip(text: string, max: number, logFile?: string): string {
  if (text.length <= max) return text
  const dropped = text.length - max
  const where = logFile ? ` — full text in ${logFile}` : ''
  return `${text.slice(0, max)}… [truncated, ${dropped} more char(s)${where}]`
}

// ---------------------------------------------------------------------------
// Log readers — the raw, per-runtime observation half.
// ---------------------------------------------------------------------------

/**
 * The completion object `claude --print --output-format json` writes.
 *
 * Shape per Claude Code's documented `--output-format json` result object.
 * Every field is optional here: an older binary, a crash before completion,
 * or a killed process all leave something (or nothing) to read, and none of
 * those may become a fabricated success.
 */
export interface ClaudeCompletionRecord {
  subtype: string | null
  isError: boolean | undefined
  numTurns: number | null
  durationMs: number | null
  result: string | null
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

/** Marker `claude-code.ts` writes before launching; everything after it is the child's own stdout. */
const SPAWN_HEADER_MARKER = '[spawn-start] ---\n'

/**
 * Read the claude completion object out of a run log.
 *
 * Deliberately identical in its brace-span scanning to the
 * `parseClaudeJsonOutput()` this replaces (pieces7 / TOD-2381 round 3) so the
 * token-ledger numbers it feeds are unchanged; it simply also returns the
 * `subtype` / `is_error` / `num_turns` / `result` fields that were being
 * parsed and dropped on the floor.
 *
 * Best-effort: returns null when there is nothing valid to read. A caller
 * must treat null as "not observed", never as a failure verdict.
 */
export function readClaudeCompletion(logFile: string): ClaudeCompletionRecord | null {
  const text = readFileSafe(logFile)
  if (text === null) return null
  const markerIdx = text.indexOf(SPAWN_HEADER_MARKER)
  const tail = markerIdx >= 0 ? text.slice(markerIdx + SPAWN_HEADER_MARKER.length) : text
  const firstBrace = tail.indexOf('{')
  const lastBrace = tail.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null
  let parsed: {
    subtype?: unknown
    is_error?: unknown
    num_turns?: unknown
    duration_ms?: unknown
    result?: unknown
    total_cost_usd?: unknown
    usage?: { input_tokens?: unknown; output_tokens?: unknown }
  }
  try {
    parsed = JSON.parse(tail.slice(firstBrace, lastBrace + 1))
  } catch {
    return null
  }
  const record: ClaudeCompletionRecord = {
    subtype: typeof parsed.subtype === 'string' ? parsed.subtype : null,
    isError: typeof parsed.is_error === 'boolean' ? parsed.is_error : undefined,
    numTurns: typeof parsed.num_turns === 'number' ? parsed.num_turns : null,
    durationMs: typeof parsed.duration_ms === 'number' ? parsed.duration_ms : null,
    result: typeof parsed.result === 'string' ? parsed.result : null,
  }
  if (typeof parsed.usage?.input_tokens === 'number') record.inputTokens = parsed.usage.input_tokens
  if (typeof parsed.usage?.output_tokens === 'number') record.outputTokens = parsed.usage.output_tokens
  if (typeof parsed.total_cost_usd === 'number') record.costUsd = parsed.total_cost_usd
  return record
}

/**
 * Every `[spawn-failure] …` line `detached-spawn.ts` wrote into this log.
 *
 * These are the ONLY log lines in the system that mean "the launch or the
 * child errored" as a fact rather than as prose, which is why they get their
 * own reader instead of being fished out of a generic tail.
 */
export function readSpawnFailures(logFile: string): string[] {
  const text = readFileSafe(logFile)
  if (text === null) return []
  return text
    .split('\n')
    .filter(line => line.includes('[spawn-failure]'))
    .map(line => line.trim())
    .slice(-3)
}

/** Last `max` non-empty log lines, excluding this system's own bookkeeping markers. */
export function readLogTail(logFile: string, max = TAIL_LINES): string[] {
  const text = readFileSafe(logFile)
  if (text === null) return []
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !l.startsWith('[spawn-start]') && !l.startsWith('[spawn-ok]') && !l.startsWith('[spawn-exit'))
    .slice(-max)
}

function readFileSafe(logFile: string): string | null {
  try {
    return readFileSync(logFile, 'utf8')
  } catch {
    return null
  }
}
