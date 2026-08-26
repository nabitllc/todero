// ─── Regression guard: better-sqlite3 must not silently recompile ──────────
//
// TOD-2451 measured that `npm install` from the committed package-lock.json
// ran `node-gyp rebuild` on better-sqlite3 and died on a host with no C++
// toolchain, even though the package ships a working prebuilt binary for
// every platform and declares `"gypfile": false` in its own package.json.
//
// Root cause, read out of npm's own arborist source
// (@npmcli/arborist/lib/install-scripts.js): the synthetic
// `node-gyp rebuild` step is gated on `pkg.gypfile !== false`, where `pkg` is
// the dependency's record as arborist knows it while resolving from the
// lockfile — and lockfileVersion 3 has no slot for `gypfile`, so that field
// reads as `undefined`, and `undefined !== false` is `true`. Fetching the
// same package with no lockfile present (`npm install better-sqlite3` in an
// empty dir) reads gypfile from the real, freshly-fetched manifest and skips
// the rebuild correctly — the bug is specific to installing FROM a lockfile.
//
// The fix (verified against a real `npm install` AND a real `npm ci` on a
// host with no Visual Studio, see docs/rebuild/pieces/pieces7/clone-and-run.md)
// is to record `"gypfile": false` directly on the better-sqlite3 entry in
// package-lock.json, so arborist's lockfile-only view of the package carries
// the same field the real manifest does.
//
// The trap this test exists to catch: a plain `npm install` REWRITES
// package-lock.json to its own canonical shape once it succeeds, and that
// canonical shape drops the `gypfile` field again — silently. If a future
// contributor adds or bumps a dependency, runs `npm install`, and commits the
// regenerated lockfile, this fix disappears with no error anywhere, and the
// next clone-with-no-toolchain hits TOD-2451 again. `npm ci` does not
// mutate the lockfile and preserves the field; this test is the guard for
// the case where someone used `npm install` instead.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('package-lock.json: better-sqlite3 gypfile guard', () => {
  const lockPath = join(__dirname, '..', 'package-lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))

  it('records gypfile:false on the better-sqlite3 entry', () => {
    const entry = lock.packages?.['node_modules/better-sqlite3']
    expect(entry).toBeDefined()
    expect(entry.gypfile).toBe(false)
  })

  // If better-sqlite3 is ever bumped to a version whose own package.json
  // stops shipping prebuilds (checked directly, not assumed), this fix would
  // start suppressing a rebuild the package genuinely needs. Fail loudly
  // rather than silently reintroducing a different failure mode.
  it('the installed better-sqlite3 package.json still ships gypfile:false and prebuilds', () => {
    let pkg: { gypfile?: boolean; files?: string[] }
    try {
      pkg = JSON.parse(
        readFileSync(join(__dirname, '..', 'node_modules', 'better-sqlite3', 'package.json'), 'utf8'),
      )
    } catch {
      // node_modules not present in this environment (e.g. a lockfile-only
      // check before `npm install`) — the lockfile assertion above is the one
      // that matters here.
      return
    }
    expect(pkg.gypfile).toBe(false)
    expect(pkg.files).toContain('prebuilds/**')
  })
})
