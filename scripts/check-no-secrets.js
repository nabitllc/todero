#!/usr/bin/env node
/* ─── Portability + seam guard ────────────────────────────────────────────────
 *
 * Two jobs, both about being able to run somewhere else:
 *
 *  1. No credential and no one operator's database project may appear in
 *     tracked source. Todero has to run on a stranger's machine from a fresh
 *     clone plus a .env.local; a literal project ref or a JWT in the tree means
 *     it does not, and a JWT in a client component ships to every browser.
 *
 *  2. No code may go around the database seam. `lib/db.ts` is the only path to
 *     persistence, so swapping the adapter swaps the whole app. Two ways to
 *     break that keep coming back, and both fail the build here:
 *       - building a vendor HTTP URL (`rest/v1/...`) instead of `db().from()`
 *       - reading the adapter's own env vars outside `lib/db/`, which pins the
 *         app to whichever vendor those variables belong to
 *
 * Run:  node scripts/check-no-secrets.js   (npm run check:secrets)
 * CI:   runs automatically via the `prebuild` npm script.
 *
 * Node rather than bash on purpose — this guard has to run on the same set of
 * machines the app claims to support, Windows included.
 */

const { spawnSync } = require('child_process')
const path = require('path')

const REPO = path.resolve(__dirname, '..')

/** Paths where a credential match is expected and harmless. */
const SECRET_EXCLUDES = [
  ':(exclude).env*',
  ':(exclude)**/.env*',
  ':(exclude)scripts/check-no-secrets.js',
  ':(exclude)scripts/check-no-secrets.sh',
  // Acceptance harness: it greps for these literals, so it necessarily spells them.
  ':(exclude)scripts/acceptance/**',
]

/**
 * Every needle is assembled from fragments so that this file is not itself a
 * hit for the thing it looks for — otherwise every grep for the banned string
 * finds the scanner and the count is never zero.
 *
 * `paths` are git pathspecs: where to look, and what to forgive.
 */
const PATTERNS = [
  {
    needle: 'twthgapio' + 'uiqhavrcnry',
    why: "one operator's database project ref",
    paths: SECRET_EXCLUDES,
    fix: 'read the URL from the environment, via lib/db.ts.',
  },
  {
    // Scoped the same way the service_role rule below already had to be, and
    // for the same reason: as a bare substring this matched PROSE. The
    // acceptance specifications in docs/rebuild/ tell agents to grep for the
    // JWT prefix, so they necessarily spell it, and moving those docs into the
    // repo turned `npm run build` red on a clean clone.
    //
    // The bare prefix is not a credential. `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`
    // decodes to {"alg":"HS256","typ":"JWT"} — the header every HS256 token on
    // earth begins with, carrying no payload and no signature. What makes a
    // token a token is what FOLLOWS it: a dot and a payload segment.
    //
    // So match the shape of a real token instead of the shape of a description.
    // This is strictly stronger than an exclusion list would have been — a real
    // key pasted into a doc, a fixture or a changelog still fails the build,
    // where `:(exclude)docs/**` would have waved it through.
    needle: 'eyJhbGc' + 'iOi[A-Za-z0-9_-]*[.][A-Za-z0-9_-]{8,}',
    label: 'JWT',
    regex: true,
    why: 'a JWT with a payload — a credential, not configuration',
    paths: SECRET_EXCLUDES,
    fix: 'read the key from the environment, via lib/db.ts.',
  },
  {
    // Scoped two ways, because the unscoped substring version failed the build
    // on prose. It matched `<code>service_role</code> JWT in 7 client
    // components` in scripts/board/waves.json — a changelog entry describing a
    // fix — so `npm run build` could not succeed on a clean clone.
    //
    //   1. only file types that can carry a credential (source, SQL, env), so
    //      documentation, fixtures and board data are out of reach;
    //   2. only where the token is being *used* — assigned, set as a JSON/YAML
    //      key, glued to a JWT, or embedded in a project URL — not merely named.
    //
    // Prose still names it freely; `service_role: "eyJ…"` still fails.
    // POSIX ERE (git grep -E): a character class, not \s, which git's engine
    // does not honour outside -P.
    needle: 'service' + '_role["\'[:space:]]*[:=]|service' + '_role.*eyJ|supabase\\.co.*service' + '_role',
    label: 'service' + '_role',
    regex: true,
    why: 'full-privilege key name in a value or URL',
    paths: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.sql', '.env*', '**/.env*', ...SECRET_EXCLUDES],
    fix: 'read the key from the environment, via lib/db.ts.',
  },
  {
    // ─── Generic rule 1: credential SHAPE ──────────────────────────────────
    //
    // The three rules above are hand-written needles for three specific
    // Supabase-era values. They found what they were told to look for and
    // nothing else — which is how a live Discord bot token sat in
    // app/api/issues/route.ts while this script printed a general "no
    // hardcoded credentials" verdict.
    //
    // A Discord bot token is three base64url segments: an application id, a
    // timestamp, and an HMAC. Nothing has to know the VALUE to recognise it,
    // which is the whole point of a shape rule — it catches the next one too.
    //
    // Unanchored on purpose: this is looking for the shape embedded anywhere
    // in a line of source (`'Bot ' + x`, a JSON value, a shell assignment).
    // The near-identical rule in lib/connections.ts IS anchored, because it
    // validates one candidate string rather than searching a line.
    //
    // Prose survives it. "the Discord bot token", "DISCORD_BOT_TOKEN", and
    // "read it from the environment" have no three-segment base64url run, so
    // the specifications under docs/rebuild/ that discuss this very token do
    // not fail the build — the mistake this file's earlier rules made twice.
    needle: '[A-Za-z0-9_-]{23,28}[.]' + '[A-Za-z0-9_-]{6,7}[.]' + '[A-Za-z0-9_-]{27,}',
    label: 'Discord bot token',
    regex: true,
    why: 'a three-segment bot token — a live credential, not configuration',
    // App tree, scripts, docs, migrations — everything except the archived
    // companion checkout under config/, carved out for exactly the reason the
    // OpenRouter rule below already documents: those are standalone bots
    // tracked separately that still embed keys, and failing every build on
    // them would mean this rule gets deleted rather than obeyed. They are a
    // rotation job, not a build gate. Said out loud in the verdict at the
    // bottom so the scope is visible rather than implied.
    paths: ['.', ':(exclude)config/**', ...SECRET_EXCLUDES],
    fix: 'read it from process.env, or from a hub connection — lib/connections.ts, POST /api/connections/hub.',
  },
  {
    // ─── Generic rule 2: credential USE ────────────────────────────────────
    //
    // Shape rules only catch shapes somebody thought of. This one catches the
    // act instead: a name that means "credential" being ASSIGNED a long
    // literal. It is provider-agnostic, so a token shape nobody has written a
    // rule for still fails the build.
    //
    // Scoped the same two ways the service_role rule had to be, after that one
    // turned `npm run build` red on a clean clone by matching a changelog:
    //   1. the literal must be QUOTED and 20+ characters;
    //   2. the assignment must be direct — `X = process.env.Y ?? 'z'` does not
    //      match, because what follows the `=` is an expression, not a string.
    //
    // WHAT IT DOES NOT CATCH, stated rather than glossed: an UNQUOTED shell
    // assignment (`TOKEN=abc123…`). An earlier draft covered that and matched
    // scripts/setup.mjs:85, which documents the template line
    // `MC_PASSWORD=YOUR_MC_ADMIN_PASSWORD` in a comment — prose, not a
    // credential. Rather than ship a rule that fails the build on its own
    // documentation, the quoted form is the rule and the shape rules above
    // are what cover unquoted values.
    needle:
      '(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)' +
      '["\'[:space:]]*[:=][[:space:]]*["\'][A-Za-z0-9_.:/+-]{20,}["\']',
    label: 'credential assigned a literal',
    regex: true,
    why: 'a name meaning "credential" set to a long quoted literal',
    paths: ['.', ':(exclude)config/**', ...SECRET_EXCLUDES],
    fix: 'read it from process.env, or from a hub connection — lib/connections.ts.',
  },
  {
    needle: 'sk-or-' + 'v1-',
    why: 'OpenRouter API key',
    // App tree only. `config/scripts/*.py` are archived standalone bots that
    // still embed a key; they are outside the Next app and tracked separately.
    paths: ['app/', 'lib/', 'components/', 'hooks/'],
    fix: 'read it from process.env.OPENROUTER_API_KEY.',
  },
  {
    // The seam's whole point: no call site may speak a vendor's HTTP dialect.
    needle: 'rest' + '/v1',
    why: 'vendor REST path — this bypasses the database seam',
    paths: ['app/', 'lib/', 'components/', 'hooks/', ':(exclude)app/api/db/**'],
    fix: 'use db().from(table) from lib/db.ts instead of building a URL.',
  },
  {
    needle: 'SUPABASE_SERVICE' + '_ROLE_KEY',
    why: "an adapter's env var read outside lib/db/",
    paths: [
      'app/', 'lib/', 'components/', 'hooks/',
      ':(exclude)lib/db.ts', ':(exclude)lib/db/**', ':(exclude)lib/__tests__/**',
    ],
    fix: 'use isDbConfigured() / dbMissingEnv() / dbStatusMessage() from lib/db.ts.',
  },
  {
    needle: 'NEXT_PUBLIC_SUPABASE' + '_URL',
    why: "an adapter's env var read outside lib/db/",
    paths: [
      'app/', 'lib/', 'components/', 'hooks/',
      ':(exclude)lib/db.ts', ':(exclude)lib/db/**', ':(exclude)lib/__tests__/**',
    ],
    fix: 'use isDbConfigured() / dbMissingEnv() / dbStatusMessage() from lib/db.ts.',
  },
]

let failed = false

for (const { needle, label, regex, why, paths, fix } of PATTERNS) {
  // --untracked so a brand-new file cannot smuggle a match past the guard;
  // .gitignore still applies, so node_modules/ and .next/ stay out.
  // -F for a literal needle, -E when the rule needs context around the token.
  const matcher = regex ? '-E' : '-F'
  const res = spawnSync('git', ['grep', '-n', '-I', matcher, '--untracked', needle, '--', ...paths], {
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
    console.error(`FAIL: "${label || needle}" (${why}) found in tracked source:`)
    for (const line of hits.split('\n')) console.error('  ' + line.slice(0, 160))
    console.error(`  Fix: ${fix}`)
    console.error('')
  }
}

if (failed) {
  console.error('The database seam is lib/db.ts. Nothing above it may name a vendor,')
  console.error('a project URL, a credential, or a vendor HTTP path.')
  console.error('  server code  -> db(), isDbConfigured(), dbMissingEnv() from lib/db.ts')
  console.error('  client code  -> lib/db/browser.ts (same-origin proxy, no credentials)')
  console.error('  shell/python -> read the values from the environment')
  process.exit(1)
}

// ─── The verdict, scoped to the evidence ────────────────────────────────────
//
// The old line here read:
//
//   "OK: no hardcoded credentials, and no code bypassing the database seam."
//
// That is a general claim drawn from a handful of specific checks, and it was
// printed, in green, on every build for the whole period a live Discord bot
// token sat in app/api/issues/route.ts. Nobody looked, because the script said
// there was nothing to look for.
//
// A guard that reports confidence it has not earned is worse than no guard. So
// the success line now enumerates what was actually checked and names what is
// out of scope. A reader can tell in one screen whether their case was covered.
console.log(`OK: ${PATTERNS.length} rules checked, no hits.`)
console.log('  Checked: 2 generic credential rules (three-segment bot-token shape;')
console.log('           a credential-shaped NAME assigned a long quoted literal),')
console.log('           4 named values (one project ref, JWTs with a payload, a')
console.log('           full-privilege key name in a value, an OpenRouter key),')
console.log('           and 3 database-seam rules.')
console.log('  NOT checked: unquoted shell assignments, credential shapes with no')
console.log('           rule above (AWS, Stripe, GitHub, SSH keys), anything under')
console.log('           config/ (the archived companion checkout — rotate separately),')
console.log('           and files git ignores.')
console.log('  This is not a statement that the tree contains no credential.')
