import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveMember, syncDiscordProfile } from '@/lib/auth'

const fail = (base: string, reason: string) => NextResponse.redirect(new URL(`/auth/error?reason=${reason}`, base))

export async function GET(request: Request) {
  const url = new URL(request.url)
  const base = url.origin
  const providerError = url.searchParams.get('error')

  if (providerError) {
    const providerCode = url.searchParams.get('error_code')
    const reason = providerError === 'access_denied'
      ? 'cancelled'
      : providerError === 'server_error' && providerCode === 'unexpected_failure'
        ? 'provider_exchange'
        : 'provider_callback'
    console.warn('[ADP auth] Supabase returned an OAuth provider error', {
      providerError,
      providerCode,
    })
    return fail(base, reason)
  }

  const code = url.searchParams.get('code')
  if (!code) return fail(base, 'missing_code')

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data.user || !data.session) {
      console.error('[ADP auth] Supabase session exchange failed', {
        code: error?.code ?? 'missing_user_or_session',
        status: error?.status ?? null,
      })
      return fail(base, 'session_exchange')
    }

    try {
      await syncDiscordProfile(data.user)
    } catch (profileError) {
      console.error('[ADP auth] Discord profile sync failed', {
        name: profileError instanceof Error ? profileError.name : 'UnknownError',
      })
      return fail(base, 'profile_sync')
    }

    const member = await resolveMember()
    if (member.status === 'authenticated') {
      return NextResponse.redirect(new URL('/library', base))
    }
    if (member.status === 'not_whitelisted' || member.status === 'identity_mismatch') {
      return NextResponse.redirect(new URL('/access-denied', base))
    }
    if (member.status === 'no_session' || member.status === 'session_error') {
      console.error('[ADP auth] Session did not persist after callback', { status: member.status })
      return fail(base, 'session_persistence')
    }
    console.error('[ADP auth] Whitelist lookup failed after callback', { status: member.status })
    return fail(base, 'authorization_check')
  } catch (error) {
    console.error('[ADP auth] Callback processing threw', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return fail(base, 'session_exchange')
  }
}
