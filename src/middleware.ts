import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'

const PUBLIC_PATHS = [
  '/login',
  '/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/auth/me',
  '/api/health',        // Railway health check — always 200
  '/api/cron',
  '/robots.txt',
]

const ADMIN_PAGE_PATHS = ['/dashboard/admin', '/dashboard/settings']
const ADMIN_API_PATHS = ['/api/admin', '/api/settings']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isApiRoute = pathname.startsWith('/api/')

  // Always allow static files, Next.js internals, and public paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next()
  }

  const session = getSessionFromRequest(req)

  // No session ─────────────────────────────────────────────────
  if (!session) {
    // API routes: return 401 JSON — never redirect
    if (isApiRoute) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }
    // Pages: redirect to login using req.nextUrl so the hostname is correct
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = `?from=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(loginUrl)
  }

  // Has session ─────────────────────────────────────────────────
  // Admin-only pages
  if (ADMIN_PAGE_PATHS.some((p) => pathname.startsWith(p)) && session.role !== 'ADMIN') {
    const url = req.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Admin-only API routes
  if (ADMIN_API_PATHS.some((p) => pathname.startsWith(p)) && session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
