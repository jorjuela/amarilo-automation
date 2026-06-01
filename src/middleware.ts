import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

const PUBLIC_PATHS = ['/login', '/setup', '/api/auth/login', '/api/auth/setup', '/api/cron']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths and static files
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname === '/robots.txt'
  ) {
    return NextResponse.next()
  }

  const session = getSessionFromRequest(req)

  // No session → redirect to login
  if (!session) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Admin-only routes
  const adminPaths = ['/dashboard/admin', '/dashboard/settings', '/api/admin', '/api/settings']
  if (adminPaths.some(p => pathname.startsWith(p))) {
    if (session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
