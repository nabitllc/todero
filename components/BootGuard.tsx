'use client'

import { useEffect } from 'react'

/**
 * Proof-of-hydration marker for the boot guard in app/layout.tsx.
 *
 * The SSR shell of Mission Control renders every panel's chrome — headings,
 * badges, progress bars — before a single request has been made. When the app
 * bundle fails to load (a stale `.next` chunk 404s, a syntax error in a route
 * kills the compile) React never hydrates, no fetch is ever issued, and that
 * shell is all the operator sees: a dashboard-shaped page that answers nothing
 * and cannot raise an ApiErrorBanner, because no API was ever called.
 *
 * This effect only runs if the client bundle actually parsed and mounted, so
 * the attribute it sets is a genuine signal that the app booted. The inline
 * script in the layout (which runs even when every chunk 404s) flips the page
 * into its stalled state when the attribute is still missing 5s after paint.
 */
export default function BootGuard() {
  useEffect(() => {
    const html = document.documentElement
    html.setAttribute('data-js-booted', '1')
    html.removeAttribute('data-boot-stalled')
  }, [])
  return null
}
