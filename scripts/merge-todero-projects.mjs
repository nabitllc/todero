#!/usr/bin/env node
// One-off: collapse four spellings of one project into `Todero`.
//
// Issues reference a project by a FREE-TEXT string with no referential integrity
// to the projects table, so the same project accumulated four names:
//   Todero 1688 · Mission Control 373 · MC 21 · mission-control 2
// plus `Infrastructure` (356), which is not a separate product — it is Todero's
// own ops and platform maintenance, and every one of its issues is closed.
//
// Authorised by Michael, 2026-08-25: "Yes. Merge Infrastructure within Todero,
// for the reasons you explained in the way you recommended."
//
// Goes through the MC API rather than the database directly, per CLAUDE.md:
// "All issue operations go through MC API. Never direct Supabase for status
// changes." Slower than a bulk UPDATE, and it means the migration is validated
// by the same rules everything else obeys.
//
// The INF-/MC- task keys are left alone. They are already unique and readable,
// and rewriting 752 keys would break every cross-reference in descriptions,
// commit messages and the vault.
//
//   node scripts/merge-todero-projects.mjs --dry     # report only
//   node scripts/merge-todero-projects.mjs           # apply

const DRY = process.argv.includes('--dry')
const BASE = process.env.TODERO_URL ?? 'http://localhost:3000'
const COOKIE = process.env.TODERO_COOKIE ?? 'mc-auth=kaos2026; mc-role=owner'
const FROM = ['Mission Control', 'MC', 'mission-control', 'Infrastructure']
const TO = 'Todero'

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { cookie: COOKIE, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(45000),
  })
  return { status: res.status, body: await res.text() }
}

const listed = await api('/api/issues?limit=0')
if (listed.status !== 200) {
  console.error(`read failed: ${listed.status} ${listed.body.slice(0, 200)}`)
  process.exit(1)
}
const rows = (() => { const j = JSON.parse(listed.body); return j.data ?? j })()

const changing = rows.filter(r => FROM.includes(r.project))
const byName = {}
for (const r of changing) byName[r.project] = (byName[r.project] ?? 0) + 1

console.log(`already "${TO}" (untouched): ${rows.filter(r => r.project === TO).length}`)
console.log('changing:')
for (const [k, v] of Object.entries(byName)) console.log(`  ${String(v).padStart(4)}  ${k} -> ${TO}`)
console.log(`total to update: ${changing.length}`)

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0) }

let ok = 0
const failures = []
for (const [i, r] of changing.entries()) {
  const res = await api('/api/issues', {
    method: 'PATCH',
    body: JSON.stringify({ id: r.id, project: TO }),
  })
  if (res.status >= 200 && res.status < 300) ok++
  else failures.push({ key: r.task_key, status: res.status, body: res.body.slice(0, 120) })

  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${changing.length} … ok ${ok}, failed ${failures.length}`)
  // Stop early rather than grind through hundreds of identical failures.
  if (failures.length >= 10) { console.error('\n10 consecutive-ish failures — stopping'); break }
}

console.log(`\nupdated ${ok}, failed ${failures.length}`)
for (const f of failures.slice(0, 5)) console.log(`  ${f.key}: ${f.status} ${f.body}`)

// Verify by re-reading, not by trusting the writes.
const after = await api('/api/issues?limit=0')
const left = (() => { const j = JSON.parse(after.body); return (j.data ?? j).filter(r => FROM.includes(r.project)).length })()
console.log(`records still under an old name: ${left}`)
process.exit(left === 0 ? 0 : 1)
