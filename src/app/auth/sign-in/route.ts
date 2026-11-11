import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const base = new URL(request.url).origin
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${base}/auth/callback` },
    })
    if (error || !data.url) {
      console.error('[ADP auth] OAuth initiation failed', {
        code: error?.code ?? 'missing_authorization_url',
        status: error?.status ?? null,
      })
      return NextResponse.redirect(new URL('/auth/error?reason=oauth_start', base))
    }
    return NextResponse.redirect(data.url)
  } catch (error) {
    console.error('[ADP auth] OAuth initiation threw', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return NextResponse.redirect(new URL('/auth/error?reason=oauth_start', base))
  }
}
