const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    config.resolve.alias['@'] = path.resolve(__dirname)
    if (!isServer) {
      // The `postgres` adapter (lib/db/pg-adapter.ts) requires node-postgres at
      // call time. Nothing in the browser ever reaches it, but lib/db.ts is in
      // the client graph, so stub the driver out of client chunks rather than
      // letting webpack try to resolve its node-only dependencies.
      config.resolve.fallback = { ...(config.resolve.fallback || {}), pg: false, 'pg-native': false }
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
