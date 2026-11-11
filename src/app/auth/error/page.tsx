import Link from 'next/link'

export const dynamic = 'force-dynamic'

const messages: Record<string, { title: string; detail: string }> = {
  cancelled: {
    title: 'Sign-in was cancelled.',
    detail: 'No Discord session was created. You can try again whenever you are ready.',
  },
  oauth_start: {
    title: 'Discord sign-in could not start.',
    detail: 'The portal could not create a Supabase authorization request. Check the Supabase Auth provider and redirect settings.',
  },
  provider_exchange: {
    title: 'Supabase could not complete Discord sign-in.',
    detail: 'Discord returned to Supabase, but Supabase could not exchange the authorization code for tokens. No portal session or whitelist check was reached. Ask an administrator to inspect Supabase Auth logs and verify the Discord OAuth credentials and provider callback URL.',
  },
  provider_callback: {
    title: 'Discord sign-in returned an error.',
    detail: 'Supabase could not complete the provider callback. Try again; if it repeats, ask an administrator to inspect Supabase Auth logs.',
  },
  missing_code: {
    title: 'The sign-in callback was incomplete.',
    detail: 'Supabase returned without an authorization code. Start a fresh Discord sign-in.',
  },
  session_exchange: {
    title: 'Supabase could not create a session.',
    detail: 'The application received the callback but could not exchange it for a Supabase session. Start a fresh sign-in; if it repeats, ask an administrator to inspect the Supabase Auth logs.',
  },
  session_persistence: {
    title: 'Your session could not be saved.',
    detail: 'The callback completed, but the portal could not read the new session from this browser. Allow first-party cookies for this Site and retry.',
  },
  profile_sync: {
    title: 'Discord signed you in, but profile setup failed.',
    detail: 'The portal could not save the authenticated Discord profile. No whitelist decision was made. Ask an administrator to check the Supabase profile table and service configuration.',
  },
  authorization_check: {
    title: 'The portal could not verify your access.',
    detail: 'Your Supabase session was created, but the server could not finish checking the Discord whitelist. Try again later or contact an administrator.',
  },
}

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason = 'provider_callback' } = await searchParams
  const message = messages[reason] ?? messages.provider_callback

  return (
    <main className="shell">
      <section className="page" style={{ maxWidth: 720, paddingTop: 96 }}>
        <div className="eyebrow">Discord authentication</div>
        <h1>{message.title}</h1>
        <p className="sub">{message.detail}</p>
        <div className="row" style={{ marginTop: 24 }}>
          <Link className="button" href="/auth/sign-in">Try Discord sign-in again</Link>
          <Link className="button secondary" href="/">Return to the portal</Link>
        </div>
      </section>
    </main>
  )
}
