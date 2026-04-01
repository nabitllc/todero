import type { Metadata, Viewport } from 'next'
import './globals.css'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ background: '#080808' }}>
      <body className="bg-[#080808] text-white min-h-screen antialiased" style={{ background: '#080808', margin: 0 }}>{children}</body>
    </html>
  )
}
