// TOD-906: Auth route — maps passwords to workspace roles
// Roles: owner (MC_PASSWORD), member (MC_MEMBER_PASSWORD), viewer (MC_VIEWER_PASSWORD)
// Legacy: admin cookie value is treated as owner throughout the app

import { NextRequest, NextResponse } from 'next/server'

const OWNER_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'
const MEMBER_PASSWORD = process.env.MC_MEMBER_PASSWORD ?? ''

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  let role: 'owner' | 'member' | 'viewer' | null = null
  let cookieValue = ''

  if (password === OWNER_PASSWORD) {
    role = 'owner'
    cookieValue = OWNER_PASSWORD
  } else if (MEMBER_PASSWORD && password === MEMBER_PASSWORD) {
    role = 'member'
    cookieValue = MEMBER_PASSWORD
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
