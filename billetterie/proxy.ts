// Filtre d'accès au back-office (Next 16 : `proxy` remplace `middleware`,
// runtime Node par défaut). Première ligne de défense seulement : chaque
// page/action/route admin re-vérifie la session via requireAdmin.

import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/admin/login') return NextResponse.next()

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  // API admin : 401 JSON ; pages : redirection vers le login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'non authentifié' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/admin/login', request.url))
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
