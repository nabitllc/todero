import { NextRequest, NextResponse } from 'next/server'

const PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'

export function middleware(req: NextRequest) {
  // Skip auth for API routes (called server-side)
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Skip auth for login page itself
  if (req.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  // Check auth cookie
  const auth = req.cookies.get('mc-auth')?.value
  if (auth !== PASSWORD) {
    // Redirect to login
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  // SPA routing: rewrite all client paths to / so page.tsx handles routing via pushState
  const { pathname } = req.nextUrl
  if (pathname !== '/' && !pathname.includes('.')) {
    return NextResponse.rewrite(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
