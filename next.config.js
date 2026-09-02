/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: "/demo", destination: "/demo/KEL/issues", permanent: false }];
  },
  async rewrites() {
    // The demo is the real local/ui built as a static SPA into public/demo.
    // afterFiles: real files under public/demo (assets, worker, fonts) win;
    // every other /demo/* path is the SPA shell.
    return { afterFiles: [{ source: "/demo/:path*", destination: "/demo/index.html" }] };
  },
}
module.exports = nextConfig
