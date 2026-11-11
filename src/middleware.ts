import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.ADP_UI_PREVIEW !== 'true') {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl
  if (pathname.startsWith('/_next/static/')) return NextResponse.next()

  if (!['GET', 'HEAD'].includes(request.method) || !['/', '/ui-preview'].includes(pathname)) {
    return new NextResponse(null, { status: 404 })
  }

  if (pathname === '/ui-preview') return NextResponse.next()

  return NextResponse.redirect(new URL('/ui-preview', request.url))
}

export const config = { matcher: '/:path*' }
