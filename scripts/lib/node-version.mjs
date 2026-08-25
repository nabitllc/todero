// ─── scripts/lib/node-version.mjs ────────────────────────────────────────────
//
// One hard prerequisite, stated once, checked before anything can fail
// obscurely because of it.
//
// `npm run setup` finishes by applying the sqlite migrations, and the sqlite
// path in scripts/db-migrate.mjs does `await import('node:sqlite')`. That
// module landed in Node 22.5.0. On anything older the import throws
// `ERR_UNKNOWN_BUILTIN_MODULE` in the middle of step 5 of a five-step setup —
// a stranger reads it as "Todero's database is broken", not "my Node is two
// versions behind". This turns that into one sentence naming the version they
// have and the version they need, printed before the work starts.
//
// Kept in step with `engines.node` in package.json.

export const MIN_NODE = '22.5.0'

/** Numeric compare of dotted versions; `1.10.0` sorts above `1.9.0`. */
function lessThan(actual, minimum) {
  const a = actual.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const b = minimum.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0)
  }
  return false
}

/**
 * Exit with a single actionable line if this Node is too old to run the
 * command that called us. Returns normally otherwise.
 */
export function requireNodeVersion(minimum = MIN_NODE) {
  if (!lessThan(process.versions.node, minimum)) return
  console.error(
    `Todero needs Node ${minimum}+ for node:sqlite; you are on v${process.versions.node}`
  )
  console.error('  Install a current Node (nodejs.org, nvm, fnm, winget install OpenJS.NodeJS)')
  console.error('  and re-run this command. Nothing has been changed.')
  process.exit(1)
}
