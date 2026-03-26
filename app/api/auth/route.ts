import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'

export async function POST(req: NextRequest) {
  const { password } = await req.json()

  if (password !== PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('mc-auth', PASSWORD, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
    sameSite: 'strict',
  })
  return res
}
