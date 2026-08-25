const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output directory. Overridable so a second `next dev` (an acceptance
  // check on another port, say) does not fight the running server over `.next`.
  distDir: process.env.TODERO_DIST_DIR || '.next',
  webpack(config, { isServer }) {
    config.resolve.alias['@'] = path.resolve(__dirname)
    if (!isServer) {
      // The `postgres` adapter (lib/db/pg-adapter.ts) requires node-postgres at
      // call time. Nothing in the browser ever reaches it, but lib/db.ts is in
      // the client graph, so stub the driver out of client chunks rather than
      // letting webpack try to resolve its node-only dependencies.
      //
      // TOD: kill-fake-infra-greens — `resolve.fallback` only applies to
      // specifiers webpack fails to resolve at all (Node core modules like
      // `fs`/`net`/`tls`, which have no package on disk). `pg` and
      // `pg-native` DO resolve (they're real installed packages), so putting
      // them under `fallback` was a no-op: webpack still bundled the real
      // `pg` package for the client and then failed on ITS `require('fs')`.
      // `pg`/`pg-native` belong under `alias` (stubs the package itself to
      // an empty module); the Node core modules `pg` reaches for at runtime
      // belong under `fallback`, so any of them fails safe as inert.
      // `better-sqlite3` is the same story for lib/db/sqlite-adapter.ts: a
      // real installed package with native (.node) bindings, required only
      // from a route handler, that the client bundle can never load anyway.
      // Aliasing it to false — same treatment as `pg` above — keeps webpack
      // from trying to bundle the native binding into a client chunk.
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        pg: false,
        'pg-native': false,
        'better-sqlite3': false,
      }
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false, net: false, tls: false, dns: false, child_process: false,
      }
    }
    return config
  },
  // Short cache on static chunks so browsers pick up new builds within a minute.
  // Prevents ChunkLoadError from sticking for hours after a rebuild.
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=60, must-revalidate' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
