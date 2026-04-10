import { NextRequest, NextResponse } from 'next/server'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

// Methods that modify data — viewers are blocked from these on API routes
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(req: NextRequest) {
  // For API routes: check role on write methods
  if (req.nextUrl.pathname.startsWith('/api/')) {
    if (WRITE_METHODS.has(req.method)) {
      const role = req.cookies.get('mc-role')?.value
      // Allow if admin, block if viewer, pass-through if no cookie (server-side calls)
      if (role === 'viewer') {
        return NextResponse.json({ error: 'Read-only access: viewer role cannot modify data' }, { status: 403 })
      }
    }
    return NextResponse.next()
  }

  // Skip auth for login page itself
  if (req.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  // Check auth cookie
  const auth = req.cookies.get('mc-auth')?.value
  if (auth !== ADMIN_PASSWORD && auth !== VIEWER_PASSWORD) {
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
