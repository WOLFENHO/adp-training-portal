import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomUUID } from 'node:crypto'
import { sanitizeApiError } from '@/lib/error-registry.mjs'

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

export async function GET() {
  return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } })
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin
  const correlationId = randomUUID()
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json(sanitizeApiError('forbidden', correlationId), { status: 403, headers })
  }
  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    return NextResponse.redirect(new URL('/', origin), { status: 303, headers })
  } catch {
    console.error('[ADP auth] sign-out failed', { correlationId, errorId: 'ADP-AUTH-004' })
    return NextResponse.json(sanitizeApiError('sign_out_unavailable', correlationId), { status: 503, headers })
  }
}
