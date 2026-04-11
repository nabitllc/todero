const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
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
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname),
    }
    return config
  },
}

module.exports = nextConfig
