#!/usr/bin/env node
// Acceptance suite runner.
//
//   node scripts/acceptance/run.mjs              # everything
//   node scripts/acceptance/run.mjs --piece rbac-permission-gate
//   node scripts/acceptance/run.mjs --json       # machine-readable, for agents
//
// Exit code is the number of failures, capped at 100 — so `&&` chains work and a
// caller can tell "one thing broke" from "nothing works".

import { CHECKS } from './checks.mjs'
import { TRUTH_CHECKS } from './checks-truth.mjs'
import { ANYWHERE_CHECKS } from './checks-anywhere.mjs'
import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const jsonMode = args.includes('--json')
const pieceIdx = args.indexOf('--piece')
const only = pieceIdx >= 0 ? args[pieceIdx + 1] : null
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? args[outIdx + 1] : null

// ── SERVER PREFLIGHT ─────────────────────────────────────────────────────────
// If the dev server is not serving, every HTTP check would report FAIL and the
// suite would look like a product regression. It is a measurement failure.
// Probe two routes that must always answer; if neither does, refuse to grade the
// HTTP checks rather than slander them.
const { http: preflightHttp } = await import('./checks.mjs')

/** Probe two routes that must always answer. Neither answering means it is down. */
async function probeServer() {
  const a = await preflightHttp('/api/health', { timeoutMs: 8000 })
  const b = await preflightHttp('/login', { timeoutMs: 8000 })
  const dead = (r) => r.status === 0 || r.status === 404
  return !(dead(a) && dead(b))
}

let serverUp = await probeServer()

// This probe used to run ONCE, before the loop. That makes it a statement about
// the server at second zero which the suite then treats as true for the whole
// run. A server that is healthy at the start and dies halfway through — which
// this one did, under memory pressure, during a critic's run — has every
// remaining transport failure graded as a PRODUCT REGRESSION. The reported
// result was 31/45 with 7 critical failures against a tree that scores 45/45.
// The suite slandered the product using a stale fact about itself.
//
// The health fact is re-established lazily now, on evidence: the first failure
// that LOOKS like a transport fault re-probes once, and everything after is
// judged against that answer. Free when nothing is wrong, honest when it is.
let recheckedMidRun = false
async function serverStillUp() {
  if (!serverUp) return false
  if (recheckedMidRun) return serverUp
  recheckedMidRun = true
  serverUp = await probeServer()
  return serverUp
}

const started = Date.now()
const ALL = [...CHECKS, ...TRUTH_CHECKS, ...ANYWHERE_CHECKS]
const picked = only ? ALL.filter(c => c.piece === only || c.id === only) : ALL
const results = []
for (const c of picked) {
  let r
  try { r = await c.run() } catch (e) { r = { ok: false, detail: `check threw: ${e.message}` } }
  // Classified by EVIDENCE, not by name. While the server is down, a failure whose
  // detail shows a transport fault did not measure the product — it measured a dead
  // socket. Name-matching missed dispatch-guard-untouched and let it report
  // "guard present but POST returned 404", which reads as a safety hole and is not one.
  const looksLikeTransport = !r.ok &&
    /\b(0|404|502|503|504)\b|NETWORK|ECONNREFUSED|not serving|unreachable|timeout/i.test(String(r.detail))
  if (looksLikeTransport && !(await serverStillUp())) {
    r = { ok: false, inconclusive: true, detail: 'INCONCLUSIVE — dev server not serving; not a product regression' }
  }
  results.push({ ...c, ...r })
}
const elapsed = Date.now() - started

const passed = results.filter(r => r.ok)
const failed = results.filter(r => !r.ok)
const inconclusive = results.filter(r => r.inconclusive)
const criticalFailed = failed.filter(r => r.critical && !r.inconclusive)

const summary = {
  total: results.length,
  passed: passed.length,
  failed: failed.length,
  criticalFailed: criticalFailed.length,
  elapsedMs: elapsed,
  inconclusive: inconclusive.length,
  serverUp,
  // Score over what was actually measurable, so a dead server does not manufacture
  // a score drop that looks like the product got worse.
  score: (results.length - inconclusive.length) > 0
    ? Number(((passed.length / (results.length - inconclusive.length)) * 10).toFixed(1))
    : 0,
  results: results.map(r => ({
    id: r.id, piece: r.piece, desc: r.desc,
    critical: !!r.critical, ok: r.ok, detail: r.detail,
  })),
}

if (outPath) await writeFile(outPath, JSON.stringify(summary, null, 2))

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log('')
  for (const r of results) {
    // An inconclusive check must not print FAIL*. It reads as a critical product
    // defect, and a critic reading this output has already been misled by it once —
    // reporting 31/45 with 7 critical failures against a tree that scores 45/45,
    // because the server had died mid-run. The mark has to say what happened.
    const mark = r.ok ? 'PASS' : (r.inconclusive ? 'SKIP ' : (r.critical ? 'FAIL*' : 'FAIL '))
    console.log(`  ${pad(mark, 6)} ${pad(r.id, 30)} ${r.detail}`)
  }
  console.log('')
  console.log(`  ${summary.passed}/${summary.total} passing` +
    (summary.criticalFailed ? `  —  ${summary.criticalFailed} CRITICAL failure(s)` : '') +
    `  (${elapsed}ms)`)
  console.log(`  harness score: ${summary.score}/10`)
  console.log('')
  if (criticalFailed.length) {
    console.log('  * critical failures invalidate downstream judgement — fix these first:')
    for (const r of criticalFailed) console.log(`      ${r.id}: ${r.detail}`)
    console.log('')
  }
}

process.exit(Math.min(failed.length, 100))
