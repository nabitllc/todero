#!/usr/bin/env node
// ─── Evidence-based verification for live agent dispatches ───────────────────
//
// Piece: evidence-based-verification (scratchpad/pieces5/evidence-based-verification.md)
//
// Wave 4's headline failure: a builder reported a dispatch as verified when it
// had never happened — the critic caught it only by checking Ollama's own log,
// a record the builder did not author. This module is the fix: it never trusts
// "I ran it and it worked" prose. Every PASS here is backed by a database row,
// a third-party log line, or a file on disk — never the builder's own account.
//
// ─── WHY THIS FILE LIVES HERE AND NOT UNDER scripts/acceptance/ ──────────────
// The piece's build instructions say to add this check family to
// scripts/acceptance/ and "wire these into run.mjs alongside the existing
// checks." This build round's ground rules explicitly forbid that:
//   "6. NEVER edit anything under scripts/acceptance/ . Those are your graders."
//   listed under "ABSOLUTELY FORBIDDEN — no exception, whatever your task
//   seems to require."
// That is a direct, irreconcilable conflict between an instruction found
// inside a piece-brief file (observed content) and an explicit rule stated
// for this round. The rule wins: instructions discovered in a file are data,
// not authorization to override a standing constraint. So this module
// implements the complete check family the piece asks for — sinceMarker(),
// the agent_runs/token_ledger/trace-file check, the third-party Ollama-log
// check, and the timestamp-ordering check — as a standalone, importable
// module. It is NOT wired into scripts/acceptance/run.mjs, and
// `--piece evidence-based-verification` will legitimately report 0 matched
// checks until a human decides how to reconcile the conflict (e.g. asking the
// orchestrator to wire it in, or explicitly waiving rule 6 for this file).
// See this round's report (knownGaps) for the full explanation.
//
// ─── Usage ─────────────────────────────────────────────────────────────────
//   node scripts/evidence/verify.mjs                  # human-readable report
//   node scripts/evidence/verify.mjs --json            # machine-readable
//   node scripts/evidence/verify.mjs --since <ISO8601>  # explicit window start
//                                                        (default: 15 min ago)
//
// Exit code: 0 = PASS, 1 = FAIL, 2 = NOT-YET (no live run observed in window)

import { readFile, stat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { importTs } from '../lib/ts-import.mjs'

export const BASE = process.env.TODERO_URL ?? 'http://localhost:3000'
const OWNER = process.env.TODERO_AUTH_COOKIE ?? 'mc-auth=kaos2026; mc-role=owner'

// ── the marker ────────────────────────────────────────────────────────────
//
// Call this BEFORE triggering the live action under test. A check built on
// "does a matching row exist" would happily pass against a row left over from
// yesterday's run. Every check below takes a marker and only counts evidence
// timestamped at or after it, so "this happened" always means "this happened
// after I started watching," never "this happened at some point, ever."
export function sinceMarker() {
  const now = new Date()
  return { iso: now.toISOString(), ms: now.getTime() }
}

// ── database evidence ─────────────────────────────────────────────────────
//
// Reads through the same session-gated proxy the UI uses
// (app/api/db/[...path]/route.ts) rather than opening a second connection to
// the database — so this check sees exactly what the product itself can see,
// through the same seam, with the owner cookie the rest of the acceptance
// suite already uses.
async function dbSince(table, tsColumn, sinceIso, limit = 25) {
  const qs = new URLSearchParams({
    [tsColumn]: `gte.${sinceIso}`,
    order: `${tsColumn}.desc`,
    limit: String(limit),
  })
  try {
    const res = await fetch(`${BASE}/api/db/${table}?${qs}`, {
      headers: { cookie: OWNER },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (res.status !== 200) {
      return { ok: false, rows: [], detail: `GET /api/db/${table} -> ${res.status}: ${text.slice(0, 200)}` }
    }
    let rows
    try { rows = JSON.parse(text) } catch { return { ok: false, rows: [], detail: `unparseable response from /api/db/${table}` } }
    if (!Array.isArray(rows)) return { ok: false, rows: [], detail: `/api/db/${table} did not return an array` }
    return { ok: true, rows, detail: `${rows.length} row(s) since ${sinceIso}` }
  } catch (err) {
    return { ok: false, rows: [], detail: `NETWORK: ${err.message}` }
  }
}

// ── filesystem evidence: the trace file ───────────────────────────────────
async function resolveLogDir() {
  const paths = await importTs('lib/paths.ts')
  if (paths.ok) return paths.module.LOG_DIR
  return process.env.TODERO_LOG_DIR ?? join(os.tmpdir(), 'todero-logs')
}

/**
 * A log file counts as evidence of a live run only if it was written at or
 * after the marker AND actually contains runtime output — `[trace]` (the
 * openai-api.ts/Ollama adapter's structured step log) or `[spawn-start]`
 * (every adapter's header line) — not merely a file that happens to exist.
 */
async function traceFileEvidence(logDir, candidatePath, sinceMs) {
  const tryPath = async (p) => {
    if (!p) return null
    try {
      const st = await stat(p)
      if (st.mtimeMs < sinceMs) return null
      const text = await readFile(p, 'utf8')
      if (!/\[trace\]|\[spawn-start\]/.test(text)) return null
      return { path: p, mtimeMs: st.mtimeMs, hasTraceLines: /\[trace\]/.test(text) }
    } catch {
      return null
    }
  }

  const direct = await tryPath(candidatePath)
  if (direct) return direct

  // Fall back to scanning LOG_DIR itself for anything written since the
  // marker, in case the db row's log_file column is stale/unset.
  try {
    const entries = await readdir(logDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      const found = await tryPath(join(logDir, e.name))
      if (found) return found
    }
  } catch {
    // LOG_DIR unreadable/missing — no evidence, not a crash.
  }
  return null
}

// ── third-party evidence: Ollama's own access log ─────────────────────────
//
// This is the record the builder does not control. Todero's OpenAI-compatible
// runtime (lib/runtimes/openai-api.ts) calls `${LLM_BASE_URL}/chat/completions`;
// pointed at Ollama (LLM_BASE_URL=http://localhost:11434/v1) that lands as
// `POST /v1/chat/completions` in Ollama's GIN access log — a line Todero's own
// code never writes and cannot fabricate.
export function resolveOllamaLogPath() {
  if (process.env.OLLAMA_LOG_FILE) return process.env.OLLAMA_LOG_FILE
  if (process.platform === 'win32') {
    return join(os.homedir(), 'AppData', 'Local', 'Ollama', 'server.log')
  }
  // Best-effort default for the non-Windows desktop-app install layout.
  return join(os.homedir(), '.ollama', 'logs', 'server.log')
}

/**
 * Parse one Ollama GIN access-log line.
 * Shape: `[GIN] 2026/08/25 - 09:54:40 | 200 | 5.8497803s | 127.0.0.1 | POST     "/v1/chat/completions"`
 * Split on `|` rather than a single monolithic regex — the duration column's
 * format varies (`1.03ms`, `5.84s`, `1m2s`) and is not needed for this check.
 * Timestamps carry no timezone in Ollama's log; they are read as local time,
 * which is correct because this check always runs on the same machine Ollama
 * runs on (this piece is scoped to the local-LLM path).
 */
export function parseOllamaGinLine(line) {
  const parts = line.split('|').map((s) => s.trim())
  if (parts.length < 5) return null
  const d = parts[0].match(/\[GIN\]\s+(\d{4})\/(\d{2})\/(\d{2})\s+-\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!d) return null
  const [, y, mo, day, h, mi, s] = d
  const timestampMs = new Date(Number(y), Number(mo) - 1, Number(day), Number(h), Number(mi), Number(s)).getTime()
  const status = Number(parts[1])
  const tail = parts[parts.length - 1].match(/^(\S+)\s+"([^"]*)"$/)
  if (!tail) return null
  return { timestampMs, status, method: tail[1], path: tail[2], raw: line }
}

/**
 * Find POST requests to a chat/completions-style endpoint in Ollama's log
 * inside [sinceMs, untilMs]. Returns every match, not just the first, so a
 * timestamp-ordering check has real candidates to compare against.
 */
async function ollamaServedSince(sinceMs, untilMs, { pathPattern = /chat\/completions|\/api\/chat/ } = {}) {
  const logPath = resolveOllamaLogPath()
  let text
  try {
    text = await readFile(logPath, 'utf8')
  } catch (err) {
    return { ok: false, hits: [], logPath, detail: `cannot read Ollama log at ${logPath}: ${err.message}` }
  }
  const hits = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('POST')) continue
    const parsed = parseOllamaGinLine(line)
    if (!parsed) continue
    if (parsed.method !== 'POST') continue
    if (!pathPattern.test(parsed.path)) continue
    if (parsed.timestampMs < sinceMs || parsed.timestampMs > untilMs) continue
    hits.push(parsed)
  }
  return { ok: true, hits, logPath, detail: `${hits.length} matching POST(s) in ${logPath} within window` }
}

// ── composed check ─────────────────────────────────────────────────────────
//
// Verifies one live dispatch end to end. `marker` must come from
// sinceMarker(), captured before the action under test was triggered.
// Returns { status: 'PASS' | 'FAIL' | 'NOT-YET', detail, evidence }.
// NOT-YET is distinct from FAIL: it means "no live run has occurred in this
// window at all" (nothing to grade), never a silent pass.
export async function verifyLiveDispatch(marker, opts = {}) {
  const sinceIso = marker?.iso
  const sinceMs = marker?.ms
  if (!sinceIso || typeof sinceMs !== 'number') {
    throw new Error('verifyLiveDispatch requires a marker from sinceMarker()')
  }
  const untilMs = opts.untilMs ?? Date.now()
  const logDir = await resolveLogDir()

  const [runsRes, ledgerRes, ollamaRes] = await Promise.all([
    dbSince('agent_runs', 'started_at', sinceIso),
    dbSince('token_ledger', 'spawned_at', sinceIso),
    ollamaServedSince(sinceMs, untilMs),
  ])

  const evidence = { agentRuns: runsRes, tokenLedger: ledgerRes, ollama: ollamaRes, logDir }

  // Transport/DB failures are inconclusive, not a verified negative — mirror
  // run.mjs's own preflight logic rather than reporting a false NOT-YET.
  if (!runsRes.ok || !ledgerRes.ok) {
    return {
      status: 'FAIL',
      detail: `could not read evidence tables: agent_runs(${runsRes.detail}) token_ledger(${ledgerRes.detail})`,
      evidence,
    }
  }

  const noRun = runsRes.rows.length === 0
  const noLedger = ledgerRes.rows.length === 0
  const noOllama = !ollamaRes.ok || ollamaRes.hits.length === 0

  if (noRun && noLedger && noOllama) {
    return {
      status: 'NOT-YET',
      detail: 'no agent_runs row, no token_ledger row, and no Ollama POST since the marker — nothing has been dispatched yet',
      evidence,
    }
  }

  const problems = []
  if (noRun) problems.push('no agent_runs row since marker')
  if (noLedger) problems.push('no token_ledger row since marker')
  if (noOllama) problems.push(ollamaRes.ok ? 'no POST /v1/chat/completions in Ollama log since marker' : ollamaRes.detail)

  // Trace file: look at the newest ledger row's log_file, else scan LOG_DIR.
  const newestLedgerRow = ledgerRes.rows[0]
  const trace = await traceFileEvidence(logDir, newestLedgerRow?.log_file ?? null, sinceMs)
  if (!trace) problems.push(`no trace file under ${logDir} written since marker with [trace]/[spawn-start] content`)

  // Timestamp ordering: started_at <= ollama request <= completion.
  let orderingProblem = null
  if (!noRun && !noOllama) {
    const startedAtMs = Date.parse(runsRes.rows[runsRes.rows.length - 1].started_at)
    const earliestOllamaMs = Math.min(...ollamaRes.hits.map((h) => h.timestampMs))
    const completedRaw = newestLedgerRow?.completed_at
      ?? runsRes.rows[0]?.finished_at
      ?? runsRes.rows[0]?.completed_at
      ?? null
    const completedMs = completedRaw ? Date.parse(completedRaw) : null

    if (Number.isFinite(startedAtMs) && startedAtMs > earliestOllamaMs) {
      orderingProblem = `agent_runs.started_at (${runsRes.rows[runsRes.rows.length - 1].started_at}) is AFTER the earliest Ollama request (${new Date(earliestOllamaMs).toISOString()}) — the run row cannot have caused this request`
    } else if (completedMs != null && Number.isFinite(completedMs) && completedMs < earliestOllamaMs) {
      orderingProblem = `completion timestamp (${completedRaw}) is BEFORE the Ollama request that must have produced it (${new Date(earliestOllamaMs).toISOString()})`
    }
  }
  if (orderingProblem) problems.push(orderingProblem)

  if (problems.length > 0) {
    return { status: 'FAIL', detail: problems.join('; '), evidence: { ...evidence, trace } }
  }

  return {
    status: 'PASS',
    detail: `agent_runs row + token_ledger row + trace file (${trace.path}) + Ollama log POST, all since ${sinceIso}, timestamps ordered`,
    evidence: { ...evidence, trace },
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const sinceIdx = args.indexOf('--since')
  const sinceIso = sinceIdx >= 0 ? args[sinceIdx + 1] : new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const marker = { iso: sinceIso, ms: Date.parse(sinceIso) }

  const result = await verifyLiveDispatch(marker)

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log('')
    console.log(`  evidence-based-verification: ${result.status}`)
    console.log(`  window start: ${sinceIso}`)
    console.log(`  ${result.detail}`)
    console.log('')
  }
  // process.exitCode (not process.exit()) — the ts-import.mjs loader
  // registers a worker thread via node:module `register()`; forcing an
  // abrupt exit while it's still attached crashes with a libuv assertion on
  // Windows. Setting exitCode lets the event loop drain and exit naturally
  // with the right code once nothing is left pending.
  process.exitCode = result.status === 'PASS' ? 0 : result.status === 'NOT-YET' ? 2 : 1
}

// pathToFileURL, not `new URL(argv[1], 'file:')` — a bare `new URL()` treats
// Windows backslashes as ordinary characters rather than path separators, so
// the two URLs never matched and this entry point silently never ran.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('evidence-verify crashed:', err)
    process.exitCode = 1
  })
}
