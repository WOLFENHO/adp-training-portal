import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const origin = new URL(request.url).origin
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
  }
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/', origin), { status: 303, headers: { 'Cache-Control': 'private, no-store' } })
}
