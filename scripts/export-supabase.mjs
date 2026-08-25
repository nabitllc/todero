#!/usr/bin/env node
// Export everything out of Supabase, before anything is archived or deleted.
//
// Michael, 2026-08-25: everything other than Limiglow is archived, "with an option
// later where I as the admin can delete them after exporting them" — and separately
// asked to move off Supabase to local SQLite until the Neon migration.
//
// This is the export half. It writes one JSON file per table plus a manifest, so
// the history survives independently of whichever database Todero is pointed at.
// Nothing is deleted here; export never destroys.
//
//   node scripts/export-supabase.mjs [--out <dir>]
//
// Default output: ./exports/supabase-<date is passed in, not generated here>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const outIdx = process.argv.indexOf('--out')
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : join(process.cwd(), 'exports', 'supabase')

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const BASE = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!BASE || !KEY) { console.error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY }

// Discover tables from the PostgREST OpenAPI document rather than guessing a list —
// a hand-written list is how an export silently misses a table.
const spec = await (await fetch(BASE + '/rest/v1/', { headers: H })).json()
const tables = Object.keys(spec.definitions ?? spec.components?.schemas ?? {}).sort()
console.log(`discovered ${tables.length} tables`)

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

const manifest = { source: BASE, tables: {}, totalRows: 0 }

for (const t of tables) {
  const rows = []
  const PAGE = 1000
  let from = 0
  // PostgREST caps a response at 1000 rows; page with Range until short.
  for (;;) {
    const res = await fetch(`${BASE}/rest/v1/${t}?select=*`, {
      headers: { ...H, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) { console.log(`  ${t}: HTTP ${res.status} — skipped`); break }
    const batch = await res.json()
    if (!Array.isArray(batch)) break
    rows.push(...batch)
    if (batch.length < PAGE) break
    from += PAGE
  }
  writeFileSync(join(OUT, `${t}.json`), JSON.stringify(rows, null, 1))
  manifest.tables[t] = rows.length
  manifest.totalRows += rows.length
  console.log(`  ${String(rows.length).padStart(6)}  ${t}`)
}

writeFileSync(join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 1))
console.log(`\n${manifest.totalRows} rows across ${Object.keys(manifest.tables).length} tables -> ${OUT}`)
