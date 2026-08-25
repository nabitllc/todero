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
let serverUp = true
{
  const a = await preflightHttp('/api/health', { timeoutMs: 8000 })
  const b = await preflightHttp('/login', { timeoutMs: 8000 })
  const dead = (r) => r.status === 0 || r.status === 404
  if (dead(a) && dead(b)) serverUp = false
}

const started = Date.now()
const ALL = [...CHECKS, ...TRUTH_CHECKS, ...ANYWHERE_CHECKS]
const picked = only ? ALL.filter(c => c.piece === only || c.id === only) : ALL
const results = []
for (const c of picked) {
  let r
  // A check that needs the server cannot be graded while the server is down.
  if (!serverUp && c.needsServer !== false && /http|api|endpoint|route|reports|armed|persists|reachable/i.test(c.id + c.desc)) {
    r = { ok: false, inconclusive: true, detail: 'INCONCLUSIVE — dev server not serving; not a product regression' }
  } else {
    try { r = await c.run() } catch (e) { r = { ok: false, detail: `check threw: ${e.message}` } }
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
    const mark = r.ok ? 'PASS' : (r.critical ? 'FAIL*' : 'FAIL ')
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
