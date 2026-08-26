#!/usr/bin/env node
/**
 * check-boolean-columns.mjs — fail the build when a column that means
 * boolean is declared in a way an `eq`/`neq` query-string filter cannot
 * match on the sqlite provider.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lib/db/query-params.ts` hands `eq`/`neq` filter values through as plain
 * STRINGS (`is_blocked=eq.false` -> `"false"`). Postgres tolerates that for
 * free — `col = $1` infers `$1`'s type from `col`, and the boolean input
 * parser accepts `'true'`/`'false'` text. SQLite has no such inference: a
 * bound TEXT parameter never equals an INTEGER-affinity 0/1 column. The fix
 * (`lib/db/pg-sql.ts` + `lib/db/sqlite-adapter.ts`) coerces the string ONLY
 * for a column the sqlite schema itself declares `BOOLEAN`, read from
 * `pragma_table_info` — so it is exact, not a guess, but it can only ever
 * help a column the SQLITE MIGRATION ACTUALLY DECLARED that way.
 *
 * `agent_run_records.succeeded`/`.failed` and `run_steps.ok` are declared
 * `boolean` in their postgres migration and plain `INTEGER` in their sqlite
 * twin — invisible to that hook. No query-string filter targets them today,
 * so nothing is broken YET, but the day an ordinary `eq.false` filter is
 * written against one of them, it reproduces the `is_blocked` defect
 * exactly, silently. `lib/db/sqlite-adapter.ts` closes that specific gap
 * with a curated `BOOLEAN_MEANING_OVERRIDES` map (see the comment there for
 * why a curated list and not a name heuristic). This script is what keeps
 * that map honest in BOTH directions, so the class cannot reopen quietly:
 *
 *   1. Every postgres-boolean column whose sqlite twin is NOT `BOOLEAN` must
 *      be in the override map — otherwise it is the exact gap this file
 *      exists to close, reintroduced.
 *   2. Every entry IN the override map must still be (a) declared `boolean`
 *      on the postgres side and (b) declared plain `INTEGER` (not already
 *      `BOOLEAN`, not something else) on the sqlite side — `kindsFor` in
 *      sqlite-adapter.ts only honours an override when the catalogue itself
 *      reports `INTEGER`; a stale entry whose sqlite type drifted to
 *      anything else is silently dead code, and a stale entry that is not
 *      really boolean on postgres would coerce a real integer/text value —
 *      both are failures worth naming, not passing quietly.
 *
 * WHERE "REAL" COMES FROM
 * -----------------------
 * Three sources, none of them a second opinion this script invents:
 *   - `migrations/*.sql` (postgres), parsed for the FINAL declared type of
 *     every column, in filename order (CREATE TABLE, then ALTER TABLE ADD
 *     COLUMN, same idiom `scripts/no-phantom-columns.mjs` already uses).
 *   - `migrations/sqlite/*.sql`, parsed the same way.
 *   - `BOOLEAN_MEANING_OVERRIDES`, the named export in
 *     `lib/db/sqlite-adapter.ts` — read from that file's own source text so
 *     there is exactly one list, not a copy that can drift from the real one.
 *
 * WHAT IT DOES NOT COVER
 * -----------------------
 *   - A column that is CONCEPTUALLY boolean but declared `boolean` on
 *     NEITHER dialect (e.g. a text `'true'`/`'false'` column) is invisible
 *     here, same as it is invisible to the fix itself — this only compares
 *     the two dialects' OWN declarations against each other.
 *   - A column present in one dialect's migrations and entirely absent from
 *     the other's is reported as a WARNING, not a failure: that is a schema
 *     drift of a different kind (`no-phantom-columns.mjs`'s territory), and
 *     a query-string filter against a genuinely missing column fails loudly
 *     ("no such column") rather than silently returning zero rows, which is
 *     what this guard exists to prevent.
 *   - Column TYPE only — this does not look at what `eq`/`neq` sites exist
 *     today (that is the piece doc's §2 inventory, done by hand once); it
 *     is a schema-shape guard, so it also catches a column nothing filters
 *     on YET, which is the whole point.
 *
 * USAGE
 *   node scripts/check-boolean-columns.mjs
 * Exit 0 = clean. Exit 1 = a boolean-meaning column is not safely coercible
 * on sqlite (listed). Exit 2 = the guard itself could not run.
 *
 * NOT WIRED INTO scripts/smoke-test-layout.sh — that file belongs to another
 * agent this session. Wiring it in is a one-line request; see
 * docs/rebuild/pieces/pieces7/boolean-columns.md for the exact line.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const PG_DIR = join(REPO_ROOT, 'migrations')
const SQLITE_DIR = join(REPO_ROOT, 'migrations', 'sqlite')
const ADAPTER_FILE = join(REPO_ROOT, 'lib', 'db', 'sqlite-adapter.ts')

const rel = (p) => relative(REPO_ROOT, p).split('\\').join('/')

function fail(msg) {
  console.error(`\n  check-boolean-columns: GUARD COULD NOT RUN — ${msg}\n`)
  process.exit(2)
}

// ── 1. Parse a migrations directory into Map<table, Map<column, TYPE>> ──────

/** Split a column-list body on top-level commas (parens nest inside CHECKs). */
function splitTopLevel(body) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

const TABLE_CONSTRAINT =
  /^\s*(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT\b|EXCLUDE\b)/i

/** The declared type of one column definition: the second whitespace token. */
function typeOfColumnDef(def) {
  const trimmed = def.trim().replace(/["`]/g, '')
  const parts = trimmed.split(/\s+/)
  return (parts[1] ?? '').toUpperCase()
}

function parseMigrationsDir(dir) {
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  } catch (e) {
    return null
  }
  if (files.length === 0) return null

  /** @type {Map<string, Map<string, string>>} */
  const schema = new Map()

  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8').replace(/--[^\n]*/g, '')
    let m

    const dropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
    while ((m = dropTable.exec(sql))) schema.delete(m[1])

    const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(?:\w+\.)?["`]?(\w+)["`]?\s*\(/gi
    while ((m = createTable.exec(sql))) {
      const table = m[1]
      let i = m.index + m[0].length - 1
      let depth = 0
      const start = i
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') {
          depth--
          if (depth === 0) break
        }
      }
      const cols = schema.get(table) ?? new Map()
      schema.set(table, cols)
      for (const part of splitTopLevel(sql.slice(start + 1, i))) {
        if (TABLE_CONSTRAINT.test(part)) continue
        const name = part.trim().split(/\s+/)[0]?.replace(/["`]/g, '')
        if (name) cols.set(name, typeOfColumnDef(part))
      }
    }

    const addCol =
      /ALTER\s+TABLE\s+["`]?(?:\w+\.)?["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s+([A-Za-z][\w]*)/gi
    while ((m = addCol.exec(sql))) {
      const cols = schema.get(m[1]) ?? new Map()
      schema.set(m[1], cols)
      cols.set(m[2], m[3].toUpperCase())
    }

    const dropCol =
      /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
    while ((m = dropCol.exec(sql))) schema.get(m[1])?.delete(m[2])
  }

  return schema
}

// ── 2. Read BOOLEAN_MEANING_OVERRIDES from its one real source ─────────────

function parseOverrides() {
  let src
  try {
    src = readFileSync(ADAPTER_FILE, 'utf8')
  } catch (e) {
    fail(`could not read ${rel(ADAPTER_FILE)}: ${e.message}`)
  }
  const decl = /BOOLEAN_MEANING_OVERRIDES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)
  if (!decl) {
    fail(
      `no \`BOOLEAN_MEANING_OVERRIDES\` object literal found in ${rel(ADAPTER_FILE)} — ` +
        `either it was renamed (update this script) or removed (the gap it covers is unguarded).`,
    )
  }
  /** @type {Map<string, string[]>} */
  const overrides = new Map()
  const entry = /(\w+)\s*:\s*\[([^\]]*)\]/g
  let m
  while ((m = entry.exec(decl[1]))) {
    const table = m[1]
    const cols = [...m[2].matchAll(/'([^']+)'|"([^"]+)"/g)].map((c) => c[1] ?? c[2])
    overrides.set(table, cols)
  }
  return overrides
}

// ── 3. Run ───────────────────────────────────────────────────────────────────

const pgSchema = parseMigrationsDir(PG_DIR)
if (!pgSchema || pgSchema.size < 5) {
  fail(`could not parse ${rel(PG_DIR)}/*.sql into a schema of any size (got ${pgSchema?.size ?? 0} tables).`)
}
const sqliteSchema = parseMigrationsDir(SQLITE_DIR)
if (!sqliteSchema || sqliteSchema.size < 5) {
  fail(`could not parse ${rel(SQLITE_DIR)}/*.sql into a schema of any size (got ${sqliteSchema?.size ?? 0} tables).`)
}
const overrides = parseOverrides()

const failures = []
const warnings = []

// Direction 1: every postgres-boolean column must be either sqlite-BOOLEAN
// or curated-override-covered.
for (const [table, cols] of pgSchema) {
  for (const [col, pgType] of cols) {
    if (pgType !== 'BOOLEAN') continue
    const sqliteCols = sqliteSchema.get(table)
    if (!sqliteCols || !sqliteCols.has(col)) {
      warnings.push(
        `${table}.${col} is declared boolean on postgres but the column does not exist at all ` +
          `in migrations/sqlite — a schema-drift issue outside this guard's scope (no-phantom-columns.mjs territory).`,
      )
      continue
    }
    const sqliteType = sqliteCols.get(col)
    if (sqliteType === 'BOOLEAN') continue // covered by the type-keyed hook itself
    const overrideCols = overrides.get(table) ?? []
    if (overrideCols.includes(col)) {
      if (sqliteType !== 'INTEGER') {
        failures.push(
          `${table}.${col}: BOOLEAN_MEANING_OVERRIDES lists this column, but ` +
            `migrations/sqlite now declares it \`${sqliteType}\`, not \`INTEGER\` — ` +
            `sqlite-adapter.ts's kindsFor() only honours the override when the catalogue ` +
            `reports INTEGER, so this entry is silently DEAD and the column is unprotected again.`,
        )
      }
      continue // declared INTEGER and covered by a live override — fine
    }
    failures.push(
      `${table}.${col}: boolean on postgres (migrations/*.sql), \`${sqliteType}\` on sqlite ` +
        `(migrations/sqlite/*.sql), and NOT in BOOLEAN_MEANING_OVERRIDES — an eq/neq query-string ` +
        `filter on this column will silently match zero rows on the sqlite provider, exactly the ` +
        `is_blocked defect from docs/rebuild/pieces/pieces7/boolean-filter.md. Either declare it ` +
        `BOOLEAN in migrations/sqlite, or add it to BOOLEAN_MEANING_OVERRIDES in lib/db/sqlite-adapter.ts.`,
    )
  }
}

// Direction 2: every override entry must still be real.
for (const [table, cols] of overrides) {
  for (const col of cols) {
    const pgType = pgSchema.get(table)?.get(col)
    if (pgType !== 'BOOLEAN') {
      failures.push(
        `${table}.${col}: listed in BOOLEAN_MEANING_OVERRIDES, but migrations/*.sql declares it ` +
          `\`${pgType ?? '(no such column)'}\`, not boolean — coercing an eq/neq string on this column ` +
          `would silently corrupt a real ${pgType ? pgType.toLowerCase() : 'value'} comparison. ` +
          `Remove the entry or fix the postgres declaration.`,
      )
    }
  }
}

console.log(
  `check-boolean-columns: ${pgSchema.size} postgres table(s), ${sqliteSchema.size} sqlite table(s), ` +
    `${[...overrides.values()].reduce((n, c) => n + c.length, 0)} override entr(ies) across ${overrides.size} table(s)`,
)
for (const w of warnings) console.log(`check-boolean-columns: WARNING — ${w}`)

if (failures.length) {
  console.error(`\n  ${failures.length} boolean-column gap(s):\n`)
  for (const f of failures) console.error(`    ${f}\n`)
  process.exit(1)
}

console.log('check-boolean-columns: OK — every postgres-boolean column is safely coercible on sqlite.')
