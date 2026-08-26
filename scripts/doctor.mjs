#!/usr/bin/env node
// ─── npm run doctor ──────────────────────────────────────────────────────────
//
// One command that answers "will Todero actually work on THIS machine, and if
// not, which line is the problem?" — without reading a single source file.
//
// It reports what the app itself resolves, not a second copy of that logic:
// the paths come from `lib/paths.ts`, the runtime list and every binary lookup
// come from `lib/runtimes/`, the database verdict comes from `lib/db.ts`, and
// the model roster is a live call through `lib/llm-provider.ts`. If the app
// would fail, doctor fails the same way and says so; if doctor is green, the
// same modules the server uses are the ones that said yes.
//
// Exit code: 0 when this host can run Todero, 1 when a required variable is
// missing, the database has not been created, or no agent runtime is
// available — so it is usable as a CI gate, not just as something to read.
//
// Usage:  npm run doctor

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'

import { REPO_ROOT, importTs } from './lib/ts-import.mjs'
import { loadEnvFiles } from './lib/env-file.mjs'
import {
  llmStatus,
  requiredEnvReport,
  recommendedGaps,
  dropPlaceholderEnv,
} from './lib/env-report.mjs'

// The app resolves TODERO_DIR from the working directory; run from anywhere.
process.chdir(REPO_ROOT)

const heading = (text) => console.log(`\n${text}\n${'─'.repeat(text.length)}`)
const row = (label, value) => console.log(`  ${String(label).padEnd(16)}${value}`)
const note = (text) => console.log(`  ${' '.repeat(16)}${text}`)

const problems = []

// ── Host ─────────────────────────────────────────────────────────────────────

function reportHost(envFiles) {
  heading('Host')
  row('platform', `${process.platform} ${process.arch} (${os.release()})`)
  row('node', process.version)
  // `npm` is a .cmd shim on Windows, which Node refuses to spawn without a
  // shell — spawning it bare is the "not found" that has no business being
  // reported by a doctor. The command is a fixed literal, never interpolated.
  const npmVersion =
    process.platform === 'win32'
      ? spawnSync('npm --version', { encoding: 'utf8', windowsHide: true, shell: true })
      : spawnSync('npm', ['--version'], { encoding: 'utf8', windowsHide: true })
  row('npm', (npmVersion.stdout ?? '').trim() || 'not found')
  row('repo', REPO_ROOT)
  row('env files', envFiles.length > 0 ? envFiles.join(', ') : 'none — run `npm run setup`')
  if (envFiles.length === 0) problems.push('no .env.local — run `npm run setup`')
}

// ── Native modules ───────────────────────────────────────────────────────────

/**
 * Does `better-sqlite3` actually load and run a query on this host?
 *
 * This is the one dependency in the tree with a compiled binary, and it is the
 * whole `sqlite` provider — the provider a clone with no account gets. When its
 * binding does not load, every data route answers 503 and `npm run db:migrate`
 * cannot create the database.
 *
 * Doctor used to be *green* in exactly that state: `requiredEnvReport()` still
 * resolves the provider name from the environment without touching the driver,
 * so doctor printed `db provider  sqlite`, `missing required env vars: 0`,
 * `OK — this host can run Todero.` and exited 0 — while `/api/health` on the
 * same checkout returned `{"ok":false,"db":{"reachable":false,…}}`. The only
 * hint was a raw `Require stack:` dump that `lib/db/boot-migrate.ts` printed
 * into the middle of the Environment section. That is the fake green this file
 * exists to catch, so it is now caught by opening a database rather than by
 * asking the environment a question.
 *
 * Requiring the module is not enough on its own: `better-sqlite3` resolves its
 * `.node` binary lazily, so the failure surfaces on first construction. This
 * opens an in-memory database and round-trips one row.
 */
function probeBetterSqlite3() {
  const require_ = createRequire(import.meta.url)
  let version = null
  try {
    version = require_('better-sqlite3/package.json').version
  } catch {
    return { ok: false, kind: 'absent', version: null, error: null }
  }
  try {
    const Database = require_('better-sqlite3')
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE doctor_probe (n INTEGER)')
      db.prepare('INSERT INTO doctor_probe VALUES (?)').run(1)
      const back = db.prepare('SELECT n FROM doctor_probe').get()
      if (!back || back.n !== 1) {
        return { ok: false, kind: 'wrong-answer', version, error: 'probe row did not read back' }
      }
    } finally {
      db.close()
    }
    return { ok: true, kind: 'ok', version, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // An ABI mismatch and an absent binary need different remedies, and the
    // difference is invisible unless doctor names it: the first is "you
    // changed Node", the second is "npm compiled instead of using the
    // prebuild that shipped in the tarball".
    const abi = /NODE_MODULE_VERSION|different Node\.js version|ERR_DLOPEN_FAILED/i.test(message)
    return { ok: false, kind: abi ? 'abi' : 'binding', version, error: message }
  }
}

function reportNativeModules() {
  heading('Native modules')
  const probe = probeBetterSqlite3()

  if (probe.ok) {
    row('better-sqlite3', `${probe.version}   binding loads, in-memory query OK`)
    return probe
  }

  if (probe.kind === 'absent') {
    row('better-sqlite3', 'not installed')
    note('node_modules/better-sqlite3 is missing — run `npm install` first.')
    return probe
  }

  row('better-sqlite3', `${probe.version}   BINDING WILL NOT LOAD`)
  // First line only: the raw error is a multi-line require stack, and the
  // point of doctor is to be readable where the stack trace was not.
  note(String(probe.error).split('\n')[0])
  if (probe.kind === 'abi') {
    note(`built for a different Node than this one (${process.version}).`)
    note('Recover with:  npm rebuild better-sqlite3')
  } else {
    note('The prebuilt binary is not there. npm runs `node-gyp rebuild` on this')
    note('package when installing from package-lock.json — the lockfile has no')
    note("field for the package's own `gypfile: false` — so on a host with no")
    note('C++ toolchain the install fails and leaves the module unusable.')
    note('Recover with:  npm install --ignore-scripts')
    note('(that flag is safe here: the prebuilt binary ships inside the tarball,')
    note(' and no package in this tree needs an install script to be usable.)')
  }
  return probe
}

// ── Resolved paths ───────────────────────────────────────────────────────────

async function reportPaths() {
  heading('Resolved paths (lib/paths.ts)')
  const mod = await importTs('lib/paths.ts')
  if (!mod.ok) {
    row('unavailable', mod.reason)
    problems.push(`could not load lib/paths.ts — ${mod.reason}`)
    return null
  }
  const p = mod.module
  for (const name of ['TODERO_DIR', 'WORKSPACE_DIR', 'CONFIG_DIR', 'LOG_DIR', 'WORKTREE_ROOT']) {
    const value = p[name]
    row(name, `${value}${existsSync(value) ? '' : '   (does not exist yet)'}`)
  }

  const agentsMd = p.resolveAgentsMdPath()
  row('AGENTS.md', agentsMd ?? 'not found')
  if (!agentsMd) {
    note('looked in:')
    for (const candidate of p.agentsMdCandidates()) note(`  ${candidate}`)
    problems.push('no AGENTS.md found — the agent roster will be empty')
  }
  return p
}

// ── CLI binaries + runtimes ──────────────────────────────────────────────────

async function reportRuntimes(paths, llm) {
  heading('CLI binaries')
  if (paths) {
    for (const name of ['git', 'node', 'npm']) {
      const resolved = paths.resolveBinary(name)
      row(name, resolved ?? 'not on PATH')
      if (name === 'git' && !resolved) {
        problems.push('git is not on PATH — worktree isolation for code agents will fail')
      }
    }
  }

  heading('Agent runtimes (lib/runtimes)')
  const mod = await importTs('lib/runtimes/index.ts')
  if (!mod.ok) {
    row('unavailable', mod.reason)
    problems.push(`could not load the runtime registry — ${mod.reason}`)
    return 0
  }

  const runtimes = await mod.module.listRuntimes()
  let availableCount = 0
  for (const runtime of runtimes) {
    const inspection = await mod.module.inspectRuntime(runtime.name)
    if (runtime.available) availableCount++
    const where = inspection.binResolved ?? `${inspection.bin} not on PATH`
    row(runtime.name, `${runtime.available ? 'available  ' : 'unavailable'}  ${where}`)
    // The registry now answers "why not" for itself, so print its answer
    // rather than a second guess made here — unless the bin column already
    // said the same sentence, which it does for the CLI adapters.
    if (!runtime.available && runtime.unavailableReason && runtime.unavailableReason !== where) {
      note(runtime.unavailableReason)
    }

    // Cross-check between two independent sensors: doctor's own live call to
    // the endpoint (reportLlm) and the runtime registry's probe. `openai-api`
    // has no binary to look for, so a configured-but-dead endpoint reporting
    // "available" is exactly the fake green doctor exists to catch. The
    // registry now probes too and should never disagree — if it ever does,
    // one of the two is lying and that is worth failing over.
    if (runtime.name === 'openai-api' && runtime.available && llm && !llm.ok) {
      note(`but ${llm.baseUrl} does not answer — dispatch through it will fail`)
      problems.push(
        `runtime openai-api reports available while ${llm.baseUrl} is unreachable`,
      )
    }
  }
  row('available', `${availableCount} of ${runtimes.length}`)
  if (availableCount === 0) {
    problems.push('no agent runtime is available — install a CLI or configure LLM_BASE_URL')
  }
  return availableCount
}

// ── LLM endpoint ─────────────────────────────────────────────────────────────

async function reportLlm() {
  heading('LLM endpoint')
  const status = await llmStatus()
  row('LLM_BASE_URL', status.baseUrl)

  if (!status.ok) {
    row('reachable', 'no')
    note(status.error)
    problems.push(`no LLM answered at ${status.baseUrl}`)
    return status
  }

  row('reachable', `yes — ${status.models.length} model${status.models.length === 1 ? '' : 's'}`)
  for (const id of status.models) row('', `- ${id}`)

  const wanted = process.env.LLM_MODEL?.trim()
  if (wanted) {
    const known = status.models.includes(wanted)
    row('LLM_MODEL', `${wanted}${known ? '' : '   NOT served by this endpoint'}`)
    if (!known) problems.push(`LLM_MODEL=${wanted} is not served by ${status.baseUrl}`)
  } else {
    row('LLM_MODEL', `unset — first model reported (${status.models[0]}) will be used`)
  }
  return status
}

// ── Live database check ──────────────────────────────────────────────────────
//
// TOD-2451 fixed one fake green (a broken better-sqlite3 binding) by opening
// an in-memory database. That proved the DRIVER works; it never opens the
// REAL data file, so it cannot catch the file itself being unreadable. Measured
// directly: with `db.sqlite` overwritten by 2000 garbage bytes, `requiredEnvReport()`
// still resolved `provider sqlite`, `missing required env vars: 0`, and doctor
// printed "OK — this host can run Todero." and exited 0 — a raw
// `[boot-migrate] boot migration failed: file is not a database` line was
// printed by an unrelated module's side effect, above the reassuring summary,
// and nothing in `problems[]` ever heard about it. Corruption of the actual
// bytes on disk is exactly the state a doctor exists to catch and did not.
//
// This opens the real file (never `:memory:`) read-only and runs one query.
// For `postgres`, `requiredEnvReport()` only ever checked whether `DATABASE_URL`
// is *set* — never whether anything answers at the other end, so a dead
// Postgres reported the same "missing required env vars: 0" a live one would.
// This makes one real connection attempt with a short timeout instead.
async function reportDatabaseHealth(env) {
  heading('Database (live check)')

  if (env.provider === 'sqlite') {
    return reportSqliteHealth()
  }
  if (env.provider === 'postgres') {
    return reportPostgresHealth()
  }
  row('provider', `${env.provider} — no live check wired for this provider`)
  return { ok: null, checked: false }
}

async function reportSqliteHealth() {
  const mod = await importTs('lib/db/sqlite-adapter.ts')
  if (!mod.ok) {
    row('unknown', `could not resolve the sqlite path — ${mod.reason}`)
    return { ok: null, checked: false }
  }
  const file = mod.module.sqlitePath()
  if (!existsSync(file)) {
    // Not created yet is reported by the Environment section already, and is
    // not a corruption finding — nothing to open yet.
    row('file', `${file}  (does not exist yet)`)
    return { ok: null, checked: false }
  }

  const require_ = createRequire(import.meta.url)
  try {
    const Database = require_('better-sqlite3')
    const db = new Database(file, { readonly: true, fileMustExist: true })
    try {
      // `PRAGMA quick_check` reads every page and catches truncation and
      // corruption that a bare `SELECT 1` on an empty handle can miss;
      // `better-sqlite3` still throws immediately on a non-database file
      // before this ever runs, which is the case actually measured here.
      const result = db.pragma('quick_check', { simple: true })
      if (result !== 'ok') {
        row('file', `${file}`)
        row('quick_check', String(result))
        problems.push(`db.sqlite failed PRAGMA quick_check: ${result}`)
        return { ok: false, checked: true }
      }
    } finally {
      db.close()
    }
    row('file', `${file}`)
    row('quick_check', 'ok — opened read-only and read every page')
    return { ok: true, checked: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    row('file', `${file}`)
    row('reachable', 'NO')
    note(message.split('\n')[0])
    problems.push(`db.sqlite will not open: ${message.split('\n')[0]}`)
    return { ok: false, checked: true }
  }
}

/** Redact credentials before ever printing a connection string. */
function redactConnectionString(url) {
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    if (u.username) u.username = u.username ? '***' : u.username
    return u.toString()
  } catch {
    return '(unparseable connection string)'
  }
}

async function reportPostgresHealth() {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    // Already reported as a missing required var by the Environment section.
    row('DATABASE_URL', 'not set')
    return { ok: null, checked: false }
  }
  row('DATABASE_URL', redactConnectionString(url))

  const require_ = createRequire(import.meta.url)
  let Client
  try {
    ;({ Client } = require_('pg'))
  } catch {
    row('reachable', 'unknown — the `pg` package is not installed')
    return { ok: null, checked: false }
  }

  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    await client.query('SELECT 1')
    row('reachable', 'yes — SELECT 1 answered')
    return { ok: true, checked: true }
  } catch (err) {
    // Node's dual-stack (IPv6-then-IPv4) connect failures surface as an
    // `AggregateError` whose own top-level `.message` is empty — measured
    // directly against a closed port: `err.message === ''`, `err.code ===
    // 'ECONNREFUSED'`, and the real per-address reasons live in `err.errors`.
    // Falling back to `.code` and then to the first nested error is the
    // difference between a blank line and a line worth reading.
    const message =
      (err instanceof Error && err.message) ||
      err?.code ||
      (Array.isArray(err?.errors) && err.errors[0]?.message) ||
      String(err)
    row('reachable', 'NO')
    note(message.split('\n')[0])
    problems.push(`Postgres at DATABASE_URL did not answer: ${message.split('\n')[0]}`)
    return { ok: false, checked: true }
  } finally {
    await client.end().catch(() => {})
  }
}

// ── Environment ──────────────────────────────────────────────────────────────

async function reportEnv(placeholders) {
  heading('Environment')
  const report = await requiredEnvReport()
  row('db provider', report.provider)
  if (report.dbDetail) row('db location', report.dbDetail)
  if (report.dbError) note(report.dbError)
  // A provider with nothing behind it is not a configured host, even though it
  // needs no variables — every query would 503 until the schema exists.
  if (report.dbDetail && report.dbDetail.includes('not created yet')) {
    problems.push('the local database has not been created — run `npm run db:migrate`')
  }

  console.log(`  missing required env vars: ${report.missing.length}`)
  for (const name of report.missing) note(`- ${name}`)
  if (report.missing.length > 0) {
    problems.push(`missing required env vars: ${report.missing.join(', ')}`)
  }

  const gaps = recommendedGaps()
  console.log(`  unset recommended env vars: ${gaps.length}`)
  for (const gap of gaps) note(`- ${gap.name}  (${gap.why})`)

  if (placeholders.length > 0) {
    console.log(`  still on template placeholders: ${placeholders.length}`)
    for (const name of placeholders) note(`- ${name}`)
  }
  return report
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log('Todero doctor')

const envFiles = loadEnvFiles(REPO_ROOT)
const placeholders = dropPlaceholderEnv()

reportHost(envFiles)
// Before anything that opens a database: if the driver will not load, every
// section below reports a symptom of this one cause, so name the cause first.
const native = reportNativeModules()
const paths = await reportPaths()
const llm = await reportLlm()
const availableRuntimes = await reportRuntimes(paths, llm)
const env = await reportEnv(placeholders)

// The driver only decides whether this host works when it is the driver this
// host uses. On a Postgres or Supabase install a broken better-sqlite3 is
// reported above and stays news rather than a verdict — but `npm run db:migrate`
// against a local file would still fail, so it is never silent.
if (!native.ok && env.provider === 'sqlite') {
  problems.push(
    native.kind === 'absent'
      ? 'better-sqlite3 is not installed, and it is the active database driver — run `npm install`'
      : 'better-sqlite3 will not load, and it is the active database driver — every data route will answer 503',
  )
}

// Only worth opening the real file once the driver itself is known good —
// otherwise this reports the same broken-binding symptom a second time in
// different words. `dbNotCreated` (checked just above via env.dbDetail) means
// there is nothing to open yet, which reportSqliteHealth also re-checks.
const dbHealth =
  native.ok || env.provider !== 'sqlite' ? await reportDatabaseHealth(env) : { ok: null, checked: false }

heading('Summary')
if (problems.length === 0) {
  console.log('  OK — this host can run Todero.')
} else {
  for (const problem of problems) console.log(`  - ${problem}`)
  console.log('')
  console.log('  Fix the lines above, then re-run `npm run doctor`.')
}
console.log('')

// A missing required variable, a database that does not exist yet, or a total
// absence of runtimes means Todero cannot do its job here. Everything else is
// reported but does not fail the command — a missing Discord token is news,
// not a broken install.
const dbNotCreated = Boolean(env.dbDetail && env.dbDetail.includes('not created yet'))
const driverBroken = !native.ok && env.provider === 'sqlite'
// The live check is the one that actually caught TOD-2451's second finding —
// a corrupt db.sqlite, or a Postgres nothing answers at, reported themselves
// as "0 missing env vars" and an exit-0 "OK" right up until this line existed.
const dbUnreachable = dbHealth.checked && dbHealth.ok === false
process.exitCode =
  env.missing.length > 0 || dbNotCreated || driverBroken || availableRuntimes === 0 || dbUnreachable
    ? 1
    : 0
