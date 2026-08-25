import type { Metadata, Viewport } from 'next'
import './globals.css'
import BootGuard from '@/components/BootGuard'

export const metadata: Metadata = {
  title: 'Todero',
  description: 'Nabit LLC — Agent Operations Dashboard',
}

// MC-522: Viewport meta is required for correct mobile touch event routing.
// Without it, browsers render at ~980px layout viewport, scale down visually,
// and fixed-position hit targets become misaligned — taps register in the wrong
// coordinate space and the app appears non-interactive on mobile.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

// Boot guard (ui-error-surfacing). Deliberately inline — no Tailwind class, no
// imported stylesheet, no bundled chunk — because the failure it reports is
// precisely "none of that loaded". Both the CSS and the timer below survive a
// 404 on /_next/static/chunks/*, which is the case that leaves the operator
// staring at an SSR shell full of dashboard chrome that never fetched anything.
const BOOT_GUARD_CSS = `
#boot-guard{display:none}
html[data-boot-stalled="1"]:not([data-js-booted="1"]) #boot-guard{display:flex}
#boot-guard{position:fixed;top:0;left:0;right:0;z-index:2147483647;
  align-items:flex-start;gap:12px;padding:12px 16px;
  font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;
  color:#f87171;background:#2a0d0d;border-bottom:1px solid rgba(239,68,68,.4)}
#boot-guard b{font-weight:600}
`

// Runs from the HTML itself, so it still runs when every JS chunk 404s.
// It never claims the app booted — only <BootGuard/> can set data-js-booted,
// and that component can only mount if the bundle really parsed.
const BOOT_GUARD_JS = `(function(){try{var h=document.documentElement;setTimeout(function(){
if(h.getAttribute('data-js-booted')!=='1'){h.setAttribute('data-boot-stalled','1')}},5000)}catch(e){}})();`

const BOOT_GUARD_MESSAGE =
  'dashboard not loaded — the app bundle failed to start, these values are not live'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: '#080808' }}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: BOOT_GUARD_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_GUARD_JS }} />
      </head>
      <body className="bg-[#080808] text-white min-h-screen antialiased" style={{ background: '#080808', margin: 0 }}>
        <div id="boot-guard" role="alert" data-testid="boot-error-banner">
          <span aria-hidden="true">⚠️</span>
          <span>{BOOT_GUARD_MESSAGE}</span>
        </div>
        <noscript>
          <div
            role="alert"
            data-testid="boot-error-banner-noscript"
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
              font: '500 13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif',
              color: '#f87171', background: '#2a0d0d', borderBottom: '1px solid rgba(239,68,68,.4)',
            }}
          >
            <span aria-hidden="true">⚠️</span>
            <span>{BOOT_GUARD_MESSAGE}</span>
          </div>
        </noscript>
        <BootGuard />
        {children}
      </body>
    </html>
  )
}
