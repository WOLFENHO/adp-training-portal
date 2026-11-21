// Default closed. The activation switch must name the exact Supabase project
// whose URL this deployment uses. The database RPCs also recheck admin access.
export function uploadsEnabled(env = process.env) {
  if (env.ADP_UPLOADS_ENABLED !== 'true' || !/^[a-z0-9]{20}$/.test(env.ADP_UPLOADS_PROJECT_REF ?? '')) return false
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return url.protocol === 'https:' && url.hostname === `${env.ADP_UPLOADS_PROJECT_REF}.supabase.co` &&
      url.username === '' && url.password === '' && url.port === '' && url.pathname === '/'
  } catch { return false }
}
