import { NextRequest, NextResponse } from 'next/server'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

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
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true, role })
  res.cookies.set('mc-auth', cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'strict',
  })
  res.cookies.set('mc-role', role, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
    sameSite: 'strict',
  })
  return res
}
