#!/usr/bin/env node
// "Shippable enough to test" — a measurable gate, not a judgement call.
//
// This is deliberately a LOWER bar than "beats the benchmark" (that is the Wave 8
// re-score). This bar asks one question: can Michael sit down with Todero and
// actually try it, without hitting a wall that makes the attempt pointless?
//
// Four things have to be true for that:
//   1. It runs on this machine and builds.
//   2. Authorization is not inverted (his own role can read; strangers cannot).
//   3. It does not lie — a tab that renders "0" over a 403 makes testing
//      worthless, because he cannot tell a broken feature from an empty one.
//   4. There is something to DO — chat reaches the local model end to end.
//
//   node scripts/acceptance/ship-gate.mjs          # human-readable
//   node scripts/acceptance/ship-gate.mjs --quiet  # one line, for a monitor
//
// Exit 0 = shippable. Exit 1 = not yet.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CHECKS, http } from './checks.mjs'
import { TRUTH_CHECKS } from './checks-truth.mjs'

const exec = promisify(execFile)
const quiet = process.argv.includes('--quiet')

// Checks that must ALL pass — the ones where failure makes a test drive pointless.
const MUST_PASS = new Set([
  'rbac-owner-reads',
  'rbac-anon-denied-read',
  'rbac-anon-denied-write',
  'core-routes-no-500',
  'ollama-reachable',
  'runtime-reports-local',
  'no-openrouter',
  'no-unchecked-json-parse',
  'no-invented-agent-fallback',
  'issues-paginated',
  'dispatch-guard-armed',
])

const blockers = []
const soft = []

// ── 1. the harness ──────────────────────────────────────────────────────────
const all = [...CHECKS, ...TRUTH_CHECKS]
let passed = 0
for (const c of all) {
  let r
  try { r = await c.run() } catch (e) { r = { ok: false, detail: `threw: ${e.message}` } }
  if (r.ok) { passed++; continue }
  if (MUST_PASS.has(c.id) || c.critical) blockers.push(`${c.id}: ${r.detail}`)
  else soft.push(c.id)
}
const pct = Math.round((passed / all.length) * 100)
if (pct < 90) soft.push(`overall ${passed}/${all.length} (${pct}%) — want 90%+`)

// ── 2. it builds ────────────────────────────────────────────────────────────
// tsc alone is not enough: Next resolves client/server boundaries at build time,
// and a server-only import pulled into a client bundle type-checks fine and then
// breaks every route at runtime. That exact bug happened here (lib/theme.ts).
try {
  await exec('npx', ['next', 'build'], { cwd: process.cwd(), timeout: 480000, shell: true })
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || e.message)
  const line = out.split('\n').filter(l => /error|failed|Error:/i.test(l))[0] || 'build failed'
  blockers.push(`next build: ${line.trim().slice(0, 160)}`)
}

// ── 3. there is something to actually do ────────────────────────────────────
// Chat has to reach the local model end to end. Without this there is no way to
// use the product at all on a machine with no cloud key — which is this machine.
try {
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'mc-auth=kaos2026; mc-role=owner' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'reply with the single word: ok' }] }),
    signal: AbortSignal.timeout(90000),
  })
  if (!res.ok) blockers.push(`chat: ${res.status} — no usable model on this host`)
  else {
    const body = await res.text()
    if (!body || body.length < 2) blockers.push('chat: empty response from the local model')
  }
} catch (e) {
  blockers.push(`chat: ${e.message}`)
}

// ── verdict ─────────────────────────────────────────────────────────────────
const shippable = blockers.length === 0

if (quiet) {
  console.log(shippable
    ? `SHIPPABLE ${passed}/${all.length}`
    : `NOTYET ${passed}/${all.length} blockers=${blockers.length}`)
} else {
  console.log('')
  console.log(shippable ? '  SHIPPABLE — worth sitting down with' : '  NOT YET')
  console.log(`  harness ${passed}/${all.length} (${pct}%)`)
  if (blockers.length) {
    console.log('')
    console.log('  Blocking a test drive:')
    for (const b of blockers) console.log(`    · ${b}`)
  }
  if (soft.length) {
    console.log('')
    console.log(`  Not blocking, still wrong: ${soft.join(', ')}`)
  }
  console.log('')
  console.log('  Note: mobile layout and visual honesty are judged by a critic,')
  console.log('  not by this script. This gate covers what a script can prove.')
  console.log('')
}

process.exit(shippable ? 0 : 1)
