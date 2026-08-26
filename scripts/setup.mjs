#!/usr/bin/env node
// ─── npm run setup ───────────────────────────────────────────────────────────
//
// The clone-to-running path, in one command, on any host that can run Node.
//
//     git clone … && cd todero && npm install && npm run setup && npm run dev
//
// It is deliberately a plain Node script and not a shell script: the repo's
// existing start.sh assumes bash and one developer's macOS home directory, so
// on Windows the first thing a stranger met was an ENOENT. Node is already a
// hard prerequisite of a Next.js app, so it is the only interpreter this may
// assume.
//
// What it does, in order:
//   1. create .env.local from .env.local.template (never overwriting one that
//      already exists) and add any keys a newer template introduced
//   2. generate the auth secrets the template ships as placeholders, and print
//      the login password — otherwise a fresh clone cannot even sign in
//   3. probe the configured LLM endpoint and print the models it serves
//   4. pick a database. If this checkout has credentials for a hosted one it
//      keeps them; if it has none it pins the file-backed `sqlite` provider,
//      which needs no server and no account
//   5. apply the migrations for whichever provider that turned out to be
//
// Step 4 is the difference between a setup script and a setup instruction
// sheet. Before it existed this command ended by naming two Supabase variables
// as the reader's homework: `npm run setup` could not finish its own job, and a
// clone that had just been "set up" answered 503 from every data route. A
// stranger now reaches a working board with no account anywhere, and moving to
// a hosted database later is filling in a variable, not a migration.
//
// It never overwrites a value a human has set, never prompts, and never fails
// the command for an unconfigured integration — every gap is printed with the
// exact next action. Exit code is non-zero only when setup could not do its own
// job (it could not write .env.local).

import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EOL } from 'node:os'

import { REPO_ROOT, importTs } from './lib/ts-import.mjs'
import { loadEnvFiles, parseEnvText, isPlaceholder } from './lib/env-file.mjs'
import { llmStatus, requiredEnvReport, dropPlaceholderEnv, probeOpenAiShape } from './lib/env-report.mjs'
import { requireNodeVersion } from './lib/node-version.mjs'

// Before anything is written or probed: step 5 applies the sqlite migrations
// through `better-sqlite3`, which needs Node 22+. Say so now, in one line,
// rather than letting a cannot-find-module stack trace end a half-finished
// setup.
requireNodeVersion()

const ENV_FILE = join(REPO_ROOT, '.env.local')
const TEMPLATE_FILE = join(REPO_ROOT, '.env.local.template')

/**
 * Keys `npm run setup` guarantees exist in .env.local, even for a checkout
 * whose .env.local predates them. Values are the local-first defaults: Todero
 * must come up talking to a machine-local model, not a cloud account nobody
 * has paid for yet.
 */
const REQUIRED_KEYS = [
  {
    key: 'LLM_BASE_URL',
    value: 'http://localhost:11434/v1',
    comment: 'OpenAI-compatible endpoint. Ollama by default; any server speaking the same shape works.',
  },
  {
    key: 'LLM_MODEL',
    value: 'qwen2.5-coder:7b',
    comment: 'Default model id, as the endpoint above names it. Blank = use the first model it reports.',
  },
  {
    key: 'LLM_API_KEY',
    value: '',
    comment: 'Bearer token for the endpoint above. Leave blank for a local server — it ignores it.',
  },
]

/**
 * Secrets `npm run setup` generates rather than leaving as a placeholder.
 *
 * These are the reason a fresh clone used to be unusable without opening an
 * editor: the template ships `MC_PASSWORD=YOUR_MC_ADMIN_PASSWORD`, the variable
 * is therefore *set*, the `?? 'kaos2026'` fallback in the code never fires, and
 * the login page rejects every password a stranger could guess. Generating them
 * makes the first run work AND is safer than a shared default that is public in
 * this repository's history.
 */
const GENERATED_SECRETS = [
  { key: 'MC_PASSWORD', label: 'owner login password', bytes: 12 },
  { key: 'MC_VIEWER_PASSWORD', label: 'read-only login password', bytes: 12 },
  { key: 'INTERNAL_SECRET', label: 'server-to-server call secret', bytes: 24 },
  { key: 'CRON_SECRET', label: '/api/cron/* secret', bytes: 24 },
]

const step = (n, title) => console.log(`\n[${n}/5] ${title}`)
const line = (text) => console.log('      ' + text)
const bullet = (text) => console.log('   -  ' + text)

// ── 1. .env.local ────────────────────────────────────────────────────────────

function ensureEnvFile() {
  step(1, '.env.local')

  if (!existsSync(ENV_FILE)) {
    if (!existsSync(TEMPLATE_FILE)) {
      console.error('      .env.local.template is missing from this checkout — cannot continue.')
      process.exit(1)
    }
    try {
      writeFileSync(ENV_FILE, readFileSync(TEMPLATE_FILE, 'utf8'))
    } catch (err) {
      console.error(`      could not write .env.local: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
    line('created .env.local from .env.local.template')
  } else {
    line('.env.local already exists — left exactly as it is')
  }

  // Add keys this script guarantees but the existing file has never heard of.
  // Only ever appends absent keys, so running setup twice changes nothing.
  const present = parseEnvText(readFileSync(ENV_FILE, 'utf8'))
  const absent = REQUIRED_KEYS.filter(entry => !(entry.key in present))
  if (absent.length > 0) {
    const block =
      EOL +
      '# ── LLM endpoint (added by `npm run setup`) ' + '─'.repeat(33) + EOL +
      absent.map(e => `# ${e.comment}${EOL}${e.key}=${e.value}`).join(EOL) + EOL
    appendFileSync(ENV_FILE, block)
    line(`added missing keys: ${absent.map(e => e.key).join(', ')}`)
  }

  fillGeneratedSecrets()

  loadEnvFiles(REPO_ROOT)
  const dropped = dropPlaceholderEnv()
  if (dropped.length > 0) {
    line(`still on template placeholders (treated as unset): ${dropped.join(', ')}`)
  }
}

/**
 * Replace placeholder auth secrets in .env.local with generated ones, and print
 * the login password once so the operator can actually sign in.
 *
 * Only ever touches a key whose value is absent or still a template
 * placeholder — a real value set by a human is never overwritten, so this is
 * safe on every re-run.
 */
function fillGeneratedSecrets() {
  let text = readFileSync(ENV_FILE, 'utf8')
  const present = parseEnvText(text)
  const generated = []

  for (const secret of GENERATED_SECRETS) {
    if (!isPlaceholder(present[secret.key])) continue
    const value = randomBytes(secret.bytes).toString('base64url')
    const assignment = `${secret.key}=${value}`
    // The template ships these commented out so that an unconfigured install
    // reports itself honestly; fill the line in place either way, so the file
    // keeps its section headings and its explanatory comments.
    const liveLine = new RegExp(`^${secret.key}=.*$`, 'm')
    const commentedLine = new RegExp(`^#\\s*${secret.key}=.*$`, 'm')
    if (liveLine.test(text)) text = text.replace(liveLine, assignment)
    else if (commentedLine.test(text)) text = text.replace(commentedLine, assignment)
    else text = text + EOL + assignment + EOL
    generated.push({ ...secret, value })
  }

  if (generated.length === 0) return

  writeFileSync(ENV_FILE, text)
  line(`generated ${generated.length} secret${generated.length === 1 ? '' : 's'} in .env.local:`)
  for (const secret of generated) {
    // The login passwords are the two an operator has to type; the other two
    // are only ever read by the server, so name them without echoing them.
    const shown = secret.key.endsWith('_PASSWORD') ? secret.value : '(written, not shown)'
    line(`  ${secret.key.padEnd(20)}${shown}   ${secret.label}`)
  }
  line('Sign in at /login with the owner password above. It is in .env.local too.')
}

// ── 2. LLM endpoint ──────────────────────────────────────────────────────────

async function checkLlm() {
  step(2, 'LLM endpoint')
  const status = await llmStatus()
  line(`LLM_BASE_URL = ${status.baseUrl}`)

  if (!status.ok) {
    line(`no answer: ${status.error}`)
    console.log('')
    bullet('Local, free: install Ollama (https://ollama.com), then')
    line('   ollama pull qwen2.5-coder:7b')
    bullet('Hosted: set LLM_BASE_URL and LLM_API_KEY in .env.local to any')
    line('   OpenAI-compatible endpoint (OpenRouter, Together, Azure, vLLM, …).')
    bullet('Todero starts either way — chat and agent dispatch stay off until one answers.')
    return status
  }

  line(`${status.models.length} model${status.models.length === 1 ? '' : 's'} available:`)
  for (const id of status.models) line(`  - ${id}`)

  // A 200-OK from ANY server, OpenAI-shaped or not, reports "0 models" the
  // same way a real Ollama with nothing pulled yet does (measured directly —
  // see docs/rebuild/pieces/pieces7/clone-and-run.md). Say which one this is,
  // here, at setup time — not as a 500 the first time chat is used.
  if (status.models.length === 0) {
    const shape = await probeOpenAiShape(status.baseUrl)
    if (shape.looksOpenAiShaped === false) {
      line(`this endpoint is reachable but is NOT an OpenAI-compatible API:`)
      line(`  ${shape.detail}`)
      bullet(`Point LLM_BASE_URL at an actual OpenAI-compatible server instead —`)
      line(`   Ollama (http://localhost:11434/v1), OpenRouter, Together, Azure, vLLM, …`)
    }
  }

  const wanted = process.env.LLM_MODEL?.trim()
  if (wanted && !status.models.includes(wanted)) {
    line(`LLM_MODEL=${wanted} is NOT one of them — pull it, or change it in .env.local.`)
  } else if (wanted) {
    line(`LLM_MODEL = ${wanted}`)
  } else {
    line(`LLM_MODEL is unset — the first model reported (${status.models[0]}) will be used.`)
  }
  return status
}

// ── 3. Database ──────────────────────────────────────────────────────────────

/**
 * Set `key` to `value` in .env.local, whether the file has it live, commented
 * out, or not at all — the same in-place rewrite `fillGeneratedSecrets` does,
 * so the file keeps its section headings and its explanatory comments.
 * Never touches a key that already has a real value.
 */
function setEnvValue(key, value) {
  let text = readFileSync(ENV_FILE, 'utf8')
  const present = parseEnvText(text)
  if (!isPlaceholder(present[key])) return false

  const assignment = `${key}=${value}`
  const liveLine = new RegExp(`^${key}=.*$`, 'm')
  const commentedLine = new RegExp(`^#\\s*${key}=.*$`, 'm')
  if (liveLine.test(text)) text = text.replace(liveLine, assignment)
  else if (commentedLine.test(text)) text = text.replace(commentedLine, assignment)
  else text = text + EOL + assignment + EOL
  writeFileSync(ENV_FILE, text)
  process.env[key] = value
  return true
}

/**
 * Decide which database this install uses, and make that decision explicit in
 * .env.local so it cannot drift later.
 *
 * `lib/db/adapters.ts` owns the rule (credentials present -> that host; nothing
 * present -> the file-backed `sqlite` provider); this step only records what it
 * resolved and reports what is still missing. Nothing here names a vendor's
 * variables — they come back from the seam itself.
 */
async function checkDatabase() {
  step(3, 'Database')
  const report = await requiredEnvReport()
  line(`provider = ${report.provider}`)

  if (report.dbError) {
    line(`could not read the database seam: ${report.dbError}`)
    return report
  }

  if (report.provider === 'sqlite') {
    // Pin it. Resolution would pick sqlite again on its own, but writing it
    // down means adding an unrelated variable later cannot silently move this
    // install onto a database whose credentials nobody filled in.
    if (setEnvValue('TODERO_DB_PROVIDER', 'sqlite')) {
      line('no hosted database is configured — pinned TODERO_DB_PROVIDER=sqlite in .env.local')
    }
    line('one file, no server, no account. Nothing to fill in.')
    bullet('Moving to a hosted database later: set the credentials in .env.local,')
    line('   delete the TODERO_DB_PROVIDER line, and re-run `npm run setup`.')
    return report
  }

  const dbMissing = report.missing.filter(name => name !== 'LLM_BASE_URL')
  if (dbMissing.length === 0) {
    line('all required database variables are set')
  } else {
    line(`missing: ${dbMissing.join(', ')}`)
    bullet('Fill them in .env.local — .env.local.template says where each value comes from.')
    bullet('Prefer any plain Postgres? Set TODERO_DB_PROVIDER=postgres and DATABASE_URL instead.')
    bullet('Want none of that? Delete those lines and re-run — Todero falls back to a local file.')
  }
  return report
}

// ── 4. Migrations ────────────────────────────────────────────────────────────

/** Run `npm run db:migrate` in this checkout. Returns true on a clean exit. */
function invokeMigrate() {
  // On Windows `npm` is a .cmd shim, which Node will not spawn without a shell.
  // The command is a fixed literal — nothing from the environment is spliced in.
  const options = { cwd: REPO_ROOT, stdio: 'inherit', windowsHide: true }
  const result =
    process.platform === 'win32'
      ? spawnSync('npm run db:migrate', { ...options, shell: true })
      : spawnSync('npm', ['run', 'db:migrate'], options)
  if (result.status === 0) return true
  line(`db:migrate exited ${result.status ?? 'without a status'} — see the output above.`)
  return false
}

async function runMigrations(report) {
  step(4, 'Migrations')

  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  if (!pkg.scripts?.['db:migrate']) {
    line('no `db:migrate` script in package.json — apply migrations/*.sql by hand, in filename order.')
    return
  }

  if (report.provider === 'sqlite') {
    line('creating the local database — `npm run db:migrate`')
    if (!invokeMigrate()) return
    const adapter = await importTs('lib/db/sqlite-adapter.ts')
    const where = adapter.ok ? adapter.module.sqlitePath() : 'db.sqlite in this checkout'
    line(`local database ready at ${where} — no account needed;`)
    line('set Supabase or DATABASE_URL later to move hosts.')
    return
  }

  if (isPlaceholder(process.env.DATABASE_URL)) {
    line('DATABASE_URL is not set — skipping `npm run db:migrate`.')
    bullet('Migrations need a DIRECT Postgres connection; an HTTP query layer has no DDL.')
    bullet('Set DATABASE_URL in .env.local and re-run `npm run setup` (or `npm run db:migrate`).')
    bullet('Hosted Postgres: copy the connection URI from your provider\'s dashboard.')
    return
  }

  line('DATABASE_URL is set — running `npm run db:migrate`')
  if (invokeMigrate()) line('migrations applied')
}

// ── 5. Summary ───────────────────────────────────────────────────────────────

function summary(llm, db) {
  step(5, 'Next steps')

  const dbMissing = (db.missing ?? []).filter(name => name !== 'LLM_BASE_URL')
  const ready = llm.ok && dbMissing.length === 0

  if (ready) {
    line(`This host is configured — database: ${db.provider}. Start it:`)
  } else {
    line('Todero will start, but these surfaces will report their own gap until fixed:')
    if (!llm.ok) bullet('chat + agent dispatch — no LLM endpoint answered')
    if (dbMissing.length > 0) bullet(`every data tab — ${dbMissing.join(', ')} not set`)
    console.log('')
    line('Start it anyway and fix them from the running app:')
  }

  line('  npm run dev       ->  http://localhost:3000')
  line('  npm run doctor    ->  full host report (paths, binaries, runtimes, env)')
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log('Todero setup — clone to running')
console.log(`  repo      ${REPO_ROOT}`)
console.log(`  platform  ${process.platform} (${process.arch})`)
console.log(`  node      ${process.version}`)

ensureEnvFile()
const llm = await checkLlm()
const db = await checkDatabase()
await runMigrations(db)
summary(llm, db)
console.log('')
