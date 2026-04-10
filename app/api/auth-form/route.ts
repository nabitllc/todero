import { NextRequest, NextResponse } from 'next/server'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

// Handles native HTML form POST (no-JS / hydration fallback)
export async function POST(req: NextRequest) {
  const data = await req.formData()
  const password = (data.get('password') as string) ?? ''
  const from = (data.get('from') as string) || '/'

  const origin = req.nextUrl.origin

  let role: 'admin' | 'viewer' | null = null
  let cookieValue = ''
  if (password === ADMIN_PASSWORD) {
    role = 'admin'
    cookieValue = ADMIN_PASSWORD
  } else if (password === VIEWER_PASSWORD) {
    role = 'viewer'
    cookieValue = VIEWER_PASSWORD
  }

  if (!role) {
    const loginUrl = new URL('/login', origin)
    loginUrl.searchParams.set('error', '1')
    if (from && from !== '/') loginUrl.searchParams.set('from', from)
    return NextResponse.redirect(loginUrl, { status: 303 })
  }

  const redirectUrl = new URL(from.startsWith('/') ? from : '/', origin)
  const res = NextResponse.redirect(redirectUrl, { status: 303 })
  res.cookies.set('mc-auth', cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'strict',
  })
  res.cookies.set('mc-role', role, {
    httpOnly: false, // readable by client JS to disable UI actions
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'strict',
  })
  return res
}
