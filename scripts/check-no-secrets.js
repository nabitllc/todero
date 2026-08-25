#!/usr/bin/env node
/* ─── Portability + secret guard ──────────────────────────────────────────────
 *
 * Fails if the tracked source tree hardcodes one operator's database project or
 * embeds a credential. Todero has to run on a stranger's machine from a fresh
 * clone plus a .env.local; a literal project ref or a JWT in the tree means it
 * does not, and a JWT in a client component means it ships to every browser.
 *
 * Run:  node scripts/check-no-secrets.js
 * CI:   runs automatically via the `prebuild` npm script.
 *
 * Node rather than bash on purpose — this guard has to run on the same set of
 * machines the app claims to support, Windows included.
 */

const { spawnSync } = require('child_process')
const path = require('path')

const REPO = path.resolve(__dirname, '..')

/**
 * Literals that must never appear in tracked source.
 *
 * Each needle is assembled from fragments so that this file is not itself a hit
 * for the thing it is looking for — otherwise every grep for the banned string
 * finds the scanner and the count is never zero.
 */
const PATTERNS = [
  { needle: 'twthgapio' + 'uiqhavrcnry', why: "one operator's database project ref" },
  { needle: 'eyJhbGc' + 'iOi', why: 'JWT header — a credential, not configuration' },
  { needle: 'service' + '_role', why: 'full-privilege key name in a value or URL' },
]

/** Paths where a match is expected and harmless. */
const EXCLUDES = [
  ':(exclude).env*',
  ':(exclude)**/.env*',
  ':(exclude)scripts/check-no-secrets.js',
  ':(exclude)scripts/check-no-secrets.sh',
]

let failed = false

for (const { needle, why } of PATTERNS) {
  // --untracked so a brand-new file cannot smuggle a key past the guard;
  // .gitignore still applies, so node_modules/ and .next/ stay out.
  const res = spawnSync('git', ['grep', '-n', '-I', '-F', '--untracked', needle, '--', ...EXCLUDES], {
    cwd: REPO,
    encoding: 'utf8',
  })
  if (res.error) {
    console.error(`check-no-secrets: could not run git grep — ${res.error.message}`)
    process.exit(2)
  }
  // git grep exits 1 with no output when nothing matched; anything else is a hit.
  const hits = (res.stdout || '').trim()
  if (hits) {
    failed = true
    console.error(`FAIL: "${needle}" (${why}) found in tracked source:`)
    for (const line of hits.split('\n')) console.error('  ' + line.slice(0, 160))
    console.error('')
  }
}

if (failed) {
  console.error('Fix: read the value from the environment instead.')
  console.error('  server code  -> lib/db.ts (db(), isDbConfigured()) or lib/db/rest.ts')
  console.error('  client code  -> lib/db/browser.ts (same-origin proxy, no credentials)')
  console.error('  shell/python -> $NEXT_PUBLIC_SUPABASE_URL / $SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

console.log('OK: no hardcoded project refs or credentials in tracked source.')
