import { timingSafeEqual } from 'node:crypto'

const ref = 'nqqarmkgnuvvqnvnodyc'
const branch = 'recovery/gold-verified-20261121'
const code = (ok, value) => ({ ok, code: `ADP-GOLD-RUNTIME-${value}` })

function equalToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function statusCode(status) {
  if (status === 401) return 'HTTP-401'
  if (status === 403) return 'HTTP-403'
  if (status === 404) return 'HTTP-404'
  if (status >= 400 && status < 500) return 'HTTP-4XX'
  if (status >= 500 && status < 600) return 'HTTP-5XX'
  return 'HTTP-UNEXPECTED'
}

export async function checkGoldRuntime(env, presented, fetcher = fetch, now = Date.now()) {
  const until = Date.parse(env.ADP_GOLD_RUNTIME_UNTIL ?? '')
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== branch ||
      !Number.isFinite(until) || until <= now || until > now + 15 * 60_000 ||
      !equalToken(presented, env.ADP_GOLD_RUNTIME_TOKEN)) return code(false, 'DISABLED')
  if (env.ADP_PREVIEW_SUPABASE_REF !== ref ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
      env.ADP_UPLOADS_ENABLED !== 'false' || env.PLAYBACK_HEARTBEATS_ENABLED !== 'false' ||
      env.MUX_METADATA_SYNC_ENABLED !== 'false' || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return code(false, 'CONFIG')
  }
  try {
    const response = await fetcher(`https://${ref}.supabase.co/rest/v1/adp_integrity_release?select=version,ready&singleton=eq.true&limit=1`, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' },
    })
    if (!response.ok) return code(false, statusCode(response.status))
    const rows = await response.json()
    return Array.isArray(rows) && rows.length === 1 && rows[0].version === 121 && rows[0].ready === true
      ? code(true, 'READY') : code(false, 'READINESS')
  } catch {
    return code(false, 'NETWORK')
  }
}
