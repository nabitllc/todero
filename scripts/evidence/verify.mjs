#!/usr/bin/env node
// ─── Evidence-based verification for live agent dispatches ───────────────────
//
// Piece: evidence-based-verification (scratchpad/pieces5/evidence-based-verification.md)
//
// Wave 4's headline failure: a builder reported a dispatch as verified when it
// had never happened — the critic caught it only by checking Ollama's own log,
// a record the builder did not author.
//
// Round 1 of this piece rebuilt that exact bug, automated. Its verifier had NO
// correlation key: it declared PASS from co-occurrence in a time window — any
// agent_runs row + any token_ledger row + a trace file grabbed by a readdir()
// fallback scan (which could land on a DIFFERENT agent's log) + any Ollama POST
// that happened to fall in the same window, regardless of which run actually
// caused it. Reproduced against live data during round 1's rejection: a
// runtime="claude-code" token_ledger row (claude-code never touches an
// OpenAI-compatible endpoint — it can NEVER have caused an Ollama request) was
// "corroborated" by an unrelated Ollama POST and a trace file that belonged to
// a completely different agent's run, entirely by accident of timing.
//
// This rewrite removes every path that let co-occurrence substitute for
// correlation:
//   1. verifyLiveDispatch() now takes ONE NAMED RUN — a token_ledger row id —
//      never "any row in the window". Zero rows matching that id -> NOT-YET.
//   2. The row's own `runtime` column gates everything else. A row whose
//      runtime is not "openai-api" is rejected immediately as FAIL — it is
//      structurally impossible for such a row to have called an
//      OpenAI-compatible endpoint, so no amount of matching timestamps
//      elsewhere can rescue it.
//   3. The Ollama correlation is no longer "something in the window" — it must
//      be a POST whose own logged timestamp falls inside this row's
//      [upstream_started_at, upstream_finished_at] window (measured by
//      lib/runtimes/openai-api.ts around the actual fetch call) AND whose own
//      logged duration matches (upstream_finished_at - upstream_started_at)
//      within 1s. Two different requests essentially never share both a
//      timestamp AND a duration by accident.
//   4. traceFileEvidence() no longer scans LOG_DIR with readdir() as a
//      fallback, and no longer accepts a bare `[spawn-start]` header line as
//      "evidence". It reads EXACTLY the path in the row's own `log_file`
//      column and requires a `[trace]` line carrying the SAME
//      provider_response_id the row itself recorded — the two facts have to
//      agree, not merely both exist somewhere.
//
// See selfTestRejectsClaudeCodeRow() below for a runnable proof: fed a
// claude-code ledger row (the literal shape of the row round 1 was fooled by)
// plus a real line from this machine's own Ollama log, verifyLiveDispatch()
// must return FAIL, not PASS.
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
// implements the complete check family the piece asks for as a standalone,
// importable module, exercised by its own CLI and its own self-test, but is
// NOT wired into scripts/acceptance/run.mjs. `--piece
// evidence-based-verification` will legitimately report 0 matched checks
// until a human decides how to reconcile the conflict (e.g. asking the
// orchestrator to wire it in, or explicitly waiving rule 6 for this file).
// Round 2's rejection did not ask for this to change — its INSTRUCTION section
// is entirely about the correlation bug above — so it is carried forward
// unchanged rather than re-litigated here.
//
// ─── Usage ─────────────────────────────────────────────────────────────────
//   node scripts/evidence/verify.mjs --run-id <token_ledger.id>  # one named run
//   node scripts/evidence/verify.mjs --since <ISO8601>           # discover the
//                                                                  newest
//                                                                  runtime=openai-api
//                                                                  row since then
//   node scripts/evidence/verify.mjs                             # --since 15
//                                                                  minutes ago
//   node scripts/evidence/verify.mjs --self-test                 # proves the
//                                                                  runtime gate
//                                                                  (see above)
//   add --json to any of the above for machine-readable output.
//
// Exit code: 0 = PASS (or self-test passed), 1 = FAIL (or self-test failed),
// 2 = NOT-YET (no live run observed yet — nothing to grade).

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { importTs } from '../lib/ts-import.mjs'

export const BASE = process.env.TODERO_URL ?? 'http://localhost:3000'
const OWNER = process.env.TODERO_AUTH_COOKIE ?? 'mc-auth=kaos2026; mc-role=owner'

// GIN access-log timestamps are truncated to whole seconds
// ("2026/08/25 - 12:21:38"), while upstream_started_at/upstream_finished_at
// carry millisecond precision. Without slack, a genuine match would fail
// spuriously whenever the logged second rounds to just outside the window.
// This does NOT reopen the co-occurrence hole: a request can only pass this
// widened window check by ALSO having its own logged duration match
// (upstream_finished_at - upstream_started_at) within 1s below — an unrelated
// request would have to coincidentally share both the second AND the exact
// duration, which two different real requests essentially never do.
const OLLAMA_TIMESTAMP_SLACK_MS = 1000
const DURATION_TOLERANCE_MS = 1000

// ── the marker (kept for callers that want "since I started watching") ─────
export function sinceMarker() {
  const now = new Date()
  return { iso: now.toISOString(), ms: now.getTime() }
}

// ── generic read through the session-gated db proxy ───────────────────────
//
// Reads through the same proxy the UI uses (app/api/db/[...path]/route.ts)
// rather than opening a second connection to the database, so this sees
// exactly what the product itself can see, through the same seam, with the
// owner cookie the rest of the acceptance suite already uses.
async function dbQuery(table, qs) {
  const query = new URLSearchParams(qs)
  try {
    const res = await fetch(`${BASE}/api/db/${table}?${query}`, {
      headers: { cookie: OWNER },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (res.status !== 200) {
      return { ok: false, rows: [], detail: `GET /api/db/${table}?${query} -> ${res.status}: ${text.slice(0, 200)}` }
    }
    let rows
    try { rows = JSON.parse(text) } catch { return { ok: false, rows: [], detail: `unparseable response from /api/db/${table}` } }
    if (!Array.isArray(rows)) return { ok: false, rows: [], detail: `/api/db/${table} did not return an array` }
    return { ok: true, rows, detail: `${rows.length} row(s)` }
  } catch (err) {
    return { ok: false, rows: [], detail: `NETWORK: ${err.message}` }
  }
}

async function defaultFetchLedgerRowById(runId) {
  return dbQuery('token_ledger', { id: `eq.${runId}`, limit: '1' })
}

/**
 * Find the newest runtime="openai-api" token_ledger row since `sinceIso`, for
 * the CLI's `--since` convenience flag. Filtering by runtime here is a
 * convenience, not a security boundary — verifyLiveDispatch() applies the
 * same runtime gate itself regardless of how a run id reached it, which is
 * exactly what the self-test below exercises by handing it a claude-code row
 * directly.
 */
export async function findLatestOpenAiRunSince(sinceIso) {
  const res = await dbQuery('token_ledger', {
    runtime: 'eq.openai-api',
    spawned_at: `gte.${sinceIso}`,
    order: 'spawned_at.desc',
    limit: '1',
  })
  if (!res.ok) return { ok: false, id: null, detail: `could not query token_ledger: ${res.detail}` }
  const row = res.rows[0]
  return row
    ? { ok: true, id: row.id, detail: `found token_ledger row ${row.id} (spawned_at=${row.spawned_at})` }
    : { ok: true, id: null, detail: `no runtime="openai-api" token_ledger row since ${sinceIso}` }
}

// ── filesystem evidence: the trace file ───────────────────────────────────
//
// EXACT path only. No readdir() scan of LOG_DIR: round 1's fallback scan is
// what let a trace file from a DIFFERENT agent's run stand in for this run's
// evidence whenever the ledger row's own log_file was missing or stale. If
// this row's log_file doesn't check out, that is itself the finding — never
// something to paper over with "well, SOME log file exists."
//
// Content match, not mere presence: the file must carry a `[trace]` JSON line
// whose provider_response_id equals the one THIS row recorded. A bare
// `[spawn-start]` header (which every runtime writes, including claude-code)
// is no longer accepted — round 1 accepted it, which meant any log file with
// ANY spawn header "corroborated" any run.
async function defaultReadTraceFile(logFilePath, expectedProviderResponseId) {
  if (!logFilePath) return { found: false, path: null, detail: 'ledger row has no log_file' }
  if (!expectedProviderResponseId) {
    return { found: false, path: logFilePath, detail: 'ledger row has no provider_response_id to match against' }
  }
  let text
  try {
    text = await readFile(logFilePath, 'utf8')
  } catch (err) {
    return { found: false, path: logFilePath, detail: `cannot read trace file at ${logFilePath}: ${err.message}` }
  }
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf('[trace] ')
    if (idx === -1) continue
    let obj
    try { obj = JSON.parse(line.slice(idx + '[trace] '.length)) } catch { continue }
    const rid = obj.provider_response_id ?? obj.providerResponseId ?? null
    if (rid && rid === expectedProviderResponseId) {
      return {
        found: true,
        path: logFilePath,
        detail: `[trace] line with provider_response_id=${expectedProviderResponseId} found in ${logFilePath}`,
      }
    }
  }
  return {
    found: false,
    path: logFilePath,
    detail: `no [trace] line in ${logFilePath} carries provider_response_id=${expectedProviderResponseId}`,
  }
}

/** Exported for callers that want LOG_DIR without pulling in a TS import themselves. */
export async function resolveLogDir() {
  const paths = await importTs('lib/paths.ts')
  if (paths.ok) return paths.module.LOG_DIR
  return process.env.TODERO_LOG_DIR ?? join(os.tmpdir(), 'todero-logs')
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

async function defaultReadOllamaLog() {
  const logPath = resolveOllamaLogPath()
  try {
    const text = await readFile(logPath, 'utf8')
    return { ok: true, text, path: logPath }
  } catch (err) {
    return { ok: false, text: '', path: logPath, detail: `cannot read Ollama log at ${logPath}: ${err.message}` }
  }
}

/**
 * Parse a Go `time.Duration.String()` value ("5.8497803s", "234.5µs"/"us",
 * "1.03ms", "1m2s", "1m2.345s", "2h3m4s") into milliseconds. Returns null if
 * nothing recognizable was found. Unit alternatives are ordered longest-first
 * ("ms" before "m", "s") so the regex doesn't split "500ms" into "500m" + a
 * dangling "s".
 */
export function parseGoDuration(str) {
  if (!str) return null
  const re = /(\d+(?:\.\d+)?)(h|ms|µs|us|ns|m|s)/g
  let totalMs = 0
  let matched = false
  let m
  while ((m = re.exec(str)) !== null) {
    matched = true
    const val = parseFloat(m[1])
    switch (m[2]) {
      case 'h': totalMs += val * 3_600_000; break
      case 'm': totalMs += val * 60_000; break
      case 's': totalMs += val * 1_000; break
      case 'ms': totalMs += val; break
      case 'µs': case 'us': totalMs += val / 1_000; break
      case 'ns': totalMs += val / 1_000_000; break
      default: break
    }
  }
  return matched ? totalMs : null
}

/**
 * Parse one Ollama GIN access-log line.
 * Shape: `[GIN] 2026/08/25 - 09:54:40 | 200 | 5.8497803s | 127.0.0.1 | POST     "/v1/chat/completions"`
 * Split on `|` rather than a single monolithic regex — the duration column's
 * format varies (`1.03ms`, `5.84s`, `1m2s`) and is now parsed by
 * parseGoDuration() into durationMs for the correlation check.
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
  const durationMs = parseGoDuration(parts[2])
  const tail = parts[parts.length - 1].match(/^(\S+)\s+"([^"]*)"$/)
  if (!tail) return null
  return { timestampMs, status, durationMs, method: tail[1], path: tail[2], raw: line }
}

// ── composed check ─────────────────────────────────────────────────────────
//
// Verifies ONE named run: `runId` must be a specific token_ledger.id, never
// "whatever matches in a window". Returns
// { status: 'PASS' | 'FAIL' | 'NOT-YET', detail, evidence }.
//
// opts lets tests inject fakes for the three IO seams (db read, Ollama log
// read, trace file read) without touching the network or filesystem — see
// selfTestRejectsClaudeCodeRow() below, which is the proof this function no
// longer commits round 1's bug.
export async function verifyLiveDispatch(runId, opts = {}) {
  if (!runId) {
    throw new Error(
      'verifyLiveDispatch requires a run id (a token_ledger row id) — pass one explicitly ' +
      '(--run-id) or discover one with findLatestOpenAiRunSince() (--since). "any row in a ' +
      'window" is exactly the bug this rewrite removes.',
    )
  }
  const fetchLedgerRowById = opts.fetchLedgerRowById ?? defaultFetchLedgerRowById
  const readOllamaLog = opts.readOllamaLog ?? defaultReadOllamaLog
  const readTraceFile = opts.readTraceFile ?? defaultReadTraceFile

  const ledgerRes = await fetchLedgerRowById(runId)
  if (!ledgerRes.ok) {
    return { status: 'FAIL', detail: `could not read token_ledger: ${ledgerRes.detail}`, evidence: { ledger: ledgerRes } }
  }
  const row = ledgerRes.rows[0]
  if (!row) {
    return {
      status: 'NOT-YET',
      detail: `no token_ledger row with id=${runId} — nothing to grade yet`,
      evidence: { ledger: ledgerRes },
    }
  }

  // ── (1) runtime gate — checked first, and it is absolute. ────────────────
  // A row whose runtime is not "openai-api" (claude-code, codex, cursor, …)
  // never calls an OpenAI-compatible endpoint, full stop. No Ollama line, no
  // trace file, no timestamp can rescue such a row — this is precisely the
  // co-occurrence bug round 1 shipped: it "verified" a runtime="claude-code"
  // row using an Ollama request that belonged to something else entirely.
  if (row.runtime !== 'openai-api') {
    return {
      status: 'FAIL',
      detail:
        `token_ledger row ${runId} has runtime="${row.runtime}" — only "openai-api" rows ever ` +
        `call an OpenAI-compatible endpoint, so this row can NEVER be corroborated by an Ollama ` +
        `log line, no matter what else lines up`,
      evidence: { ledger: ledgerRes, row },
    }
  }

  const hasUpstream = Boolean(row.provider_response_id && row.upstream_started_at && row.upstream_finished_at)
  if (!hasUpstream) {
    // Round 3: lib/runtimes/token-ledger.ts's finalizeRun() now checks the
    // error PostgREST returns when it rejects the update that would have set
    // these four columns (SQLSTATE 42703 / PGRST204, naming one of
    // migrations/054_ledger_upstream_correlation.sql's columns — proven live:
    // PostgREST rejects the WHOLE update when one column in the payload is
    // unrecognized), retries WITHOUT them so completed_at/status/tokens/cost
    // still land, and leaves this marker in metadata so the rejection is
    // distinguishable from a run that simply hasn't happened yet. Before this
    // marker existed, both cases looked identical here — missing columns —
    // and this branch reported NOT-YET for a write that had actually been
    // REJECTED. That is exactly the bug this round exists to close.
    const metadata =
      row.metadata && typeof row.metadata === 'object'
        ? row.metadata
        : (() => { try { return JSON.parse(row.metadata) } catch { return null } })()
    const migrationMarker =
      metadata && typeof metadata.upstream_correlation_unavailable === 'string'
        ? metadata.upstream_correlation_unavailable
        : null

    if (migrationMarker) {
      return {
        status: 'NOT-MIGRATED',
        detail:
          `token_ledger row ${runId} completed, but its upstream-correlation columns were REJECTED by ` +
          `the database — not merely absent, and never merely "not yet happened": ${migrationMarker}. ` +
          `Apply migrations/054_ledger_upstream_correlation.sql (npm run db:migrate with DATABASE_URL) ` +
          `to this install before this run can be verified.`,
        evidence: { ledger: ledgerRes, row },
      }
    }
    if (row.status === 'spawned') {
      return {
        status: 'NOT-YET',
        detail: `token_ledger row ${runId} is still "spawned" — no upstream correlation recorded yet`,
        evidence: { ledger: ledgerRes, row },
      }
    }
    return {
      status: 'FAIL',
      detail:
        `token_ledger row ${runId} has status="${row.status}" but no ` +
        `provider_response_id/upstream_started_at/upstream_finished_at, and no ` +
        `metadata.upstream_correlation_unavailable marker either — either this run predates round 3's ` +
        `finalizeRun() fix, or the run failed before it made a single model call`,
      evidence: { ledger: ledgerRes, row },
    }
  }

  const startMs = Date.parse(row.upstream_started_at)
  const finishMs = Date.parse(row.upstream_finished_at)
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) {
    return {
      status: 'FAIL',
      detail:
        `token_ledger row ${runId} has an unusable upstream window ` +
        `(upstream_started_at=${row.upstream_started_at}, upstream_finished_at=${row.upstream_finished_at})`,
      evidence: { ledger: ledgerRes, row },
    }
  }
  const expectedDurationMs = finishMs - startMs

  // ── (2) third-party corroboration: Ollama's own log ───────────────────────
  const ollama = await readOllamaLog()
  if (!ollama.ok) {
    return {
      status: 'FAIL',
      detail: `cannot read Ollama's own log — ${ollama.detail}`,
      evidence: { ledger: ledgerRes, row, ollama },
    }
  }

  const hits = []
  for (const line of ollama.text.split(/\r?\n/)) {
    if (!line.includes('POST')) continue
    const parsed = parseOllamaGinLine(line)
    if (!parsed || parsed.method !== 'POST') continue
    if (!/chat\/completions|\/api\/chat/.test(parsed.path)) continue
    hits.push(parsed)
  }

  const windowed = hits.filter(
    (h) => h.timestampMs > startMs - OLLAMA_TIMESTAMP_SLACK_MS && h.timestampMs < finishMs + OLLAMA_TIMESTAMP_SLACK_MS,
  )
  const matching = windowed.filter(
    (h) => h.durationMs != null && Math.abs(h.durationMs - expectedDurationMs) <= DURATION_TOLERANCE_MS,
  )

  if (matching.length === 0) {
    let why
    if (hits.length === 0) {
      why = `no POST to chat/completions in Ollama's log at ${ollama.path} at all`
    } else if (windowed.length === 0) {
      why = `${hits.length} Ollama POST(s) found in the log, but none inside ` +
        `[${row.upstream_started_at}, ${row.upstream_finished_at}]`
    } else {
      const closest = Math.min(...windowed.map((h) => Math.abs((h.durationMs ?? Infinity) - expectedDurationMs)))
      why = `${windowed.length} Ollama POST(s) inside the window, but none whose own duration matches ` +
        `(upstream_finished_at - upstream_started_at = ${expectedDurationMs}ms) within ${DURATION_TOLERANCE_MS}ms ` +
        `— closest was ${closest}ms off`
    }
    return {
      status: 'FAIL',
      detail: `no Ollama log line corroborates token_ledger row ${runId}: ${why}`,
      evidence: { ledger: ledgerRes, row, ollama: { path: ollama.path, hits, windowed } },
    }
  }

  // ── (3) trace file: exact path, matching provider_response_id ────────────
  const trace = await readTraceFile(row.log_file, row.provider_response_id)
  if (!trace.found) {
    return {
      status: 'FAIL',
      detail: `trace file check failed for token_ledger row ${runId}: ${trace.detail}`,
      evidence: { ledger: ledgerRes, row, ollama: { matching }, trace },
    }
  }

  return {
    status: 'PASS',
    detail:
      `token_ledger row ${runId} (runtime=openai-api, provider_response_id=${row.provider_response_id}) is ` +
      `corroborated by an Ollama POST /chat/completions at ${new Date(matching[0].timestampMs).toISOString()} ` +
      `(duration ${matching[0].durationMs}ms vs expected ${expectedDurationMs}ms) and a matching [trace] line ` +
      `in ${trace.path}`,
    evidence: { ledger: ledgerRes, row, ollama: { matching }, trace },
  }
}

// ── self-test: prove the runtime gate rejects round 1's exact failure ─────
//
// Feeds verifyLiveDispatch() a claude-code token_ledger row — the literal
// shape of the row round 1 was fooled by (see round 2's rejection evidence:
// runtime="claude-code", log_file a POSIX path that does not exist on this
// Windows box, status="running"/"spawned") — plus a REAL line read from this
// machine's own Ollama server log, so the proof rests on genuine third-party
// evidence, not a mock of it. If verifyLiveDispatch() ever regresses to
// co-occurrence again, this returns pass:false.
export async function selfTestRejectsClaudeCodeRow() {
  const fakeRunId = 'self-test-fake-run-id'
  const fakeClaudeCodeRow = {
    id: fakeRunId,
    agent_id: 'po',
    task_key: 'TOD-2004',
    runtime: 'claude-code',
    model: 'sonnet',
    status: 'spawned',
    log_file: '/tmp/agent-po-1787638057083.log',
    spawned_at: '2026-08-25T06:07:37.336859+00:00',
    completed_at: null,
    provider_response_id: null,
    provider_model: null,
    upstream_started_at: null,
    upstream_finished_at: null,
  }
  // A real Ollama GIN line, in the exact format this machine's own
  // %LOCALAPPDATA%\Ollama\server.log writes.
  const realOllamaLine =
    '[GIN] 2026/08/25 - 09:54:40 | 200 |    5.8497803s |       127.0.0.1 | POST     "/v1/chat/completions"\n'

  let traceFileWasChecked = false
  const result = await verifyLiveDispatch(fakeRunId, {
    fetchLedgerRowById: async (id) =>
      id === fakeRunId
        ? { ok: true, rows: [fakeClaudeCodeRow], detail: '1 row (self-test fixture)' }
        : { ok: true, rows: [], detail: '0 rows' },
    readOllamaLog: async () => ({ ok: true, text: realOllamaLine, path: '(self-test: real Ollama log line, injected)' }),
    readTraceFile: async () => {
      traceFileWasChecked = true
      return { found: false, path: null, detail: 'self-test: should never be reached' }
    },
  })

  const rejectedOnRuntime = result.status === 'FAIL' && /runtime="claude-code"/.test(result.detail)
  const pass = rejectedOnRuntime && !traceFileWasChecked
  return {
    pass,
    detail: pass
      ? `self-test OK: a claude-code token_ledger row + a real Ollama log line correctly returned ` +
        `FAIL on the runtime gate, before ever reading a trace file ("${result.detail}")`
      : `self-test FAILED: expected FAIL from the runtime gate, got status=${result.status} ` +
        `detail="${result.detail}" (trace file was ${traceFileWasChecked ? '' : 'NOT '}checked) — the ` +
        `co-occurrence bug is back`,
    result,
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
function printResult(label, result, jsonMode, extra = {}) {
  if (jsonMode) {
    console.log(JSON.stringify({ label, ...result, ...extra }, null, 2))
    return
  }
  console.log('')
  console.log(`  ${label}: ${result.status ?? (result.pass ? 'PASS' : 'FAIL')}`)
  if (extra.discoveryDetail) console.log(`  discovery: ${extra.discoveryDetail}`)
  if (extra.runId) console.log(`  run id: ${extra.runId}`)
  console.log(`  ${result.detail}`)
  console.log('')
}

async function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')

  if (args.includes('--self-test')) {
    const st = await selfTestRejectsClaudeCodeRow()
    printResult('evidence-based-verification self-test', st, jsonMode)
    process.exitCode = st.pass ? 0 : 1
    return
  }

  const runIdIdx = args.indexOf('--run-id')
  const sinceIdx = args.indexOf('--since')
  let runId = runIdIdx >= 0 ? args[runIdIdx + 1] : null
  let discoveryDetail = null

  if (!runId) {
    const sinceIso = sinceIdx >= 0 ? args[sinceIdx + 1] : new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const found = await findLatestOpenAiRunSince(sinceIso)
    discoveryDetail = found.detail
    if (!found.ok || !found.id) {
      printResult('evidence-based-verification', { status: 'NOT-YET', detail: found.detail }, jsonMode, { discoveryDetail })
      process.exitCode = 2
      return
    }
    runId = found.id
  }

  const result = await verifyLiveDispatch(runId)
  printResult('evidence-based-verification', result, jsonMode, { discoveryDetail, runId })
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
