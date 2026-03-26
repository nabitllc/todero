import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KAOS Mission Control',
  description: 'Nabit LLC — Agent Operations Dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#080808] text-white min-h-screen antialiased">{children}</body>
    </html>
  )
}
