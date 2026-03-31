import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'

// Handles native HTML form POST (no-JS / hydration fallback)
export async function POST(req: NextRequest) {
  const data = await req.formData()
  const password = (data.get('password') as string) ?? ''
  const from = (data.get('from') as string) || '/'

  const origin = req.nextUrl.origin

  if (password !== PASSWORD) {
    const loginUrl = new URL('/login', origin)
    loginUrl.searchParams.set('error', '1')
    if (from && from !== '/') loginUrl.searchParams.set('from', from)
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  const redirectUrl = new URL(from.startsWith('/') ? from : '/', origin)
  const res = NextResponse.redirect(redirectUrl, { status: 303 })
  res.cookies.set('mc-auth', PASSWORD, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
    sameSite: 'strict',
  })
  return res
}
