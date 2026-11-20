import { timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EXPECTED_REF = 'nqqarmkgnuvvqnvnodyc'
const BRANCH = 'audit/gold-local-candidate'
const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

function answer(status, code) {
  return Response.json({ ok: status === 200, code }, { status, headers: HEADERS })
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || expected.length < 32) return false
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function dataApiFailureCode(status) {
  if (status === 401) return 'ADP-GOLD-PROBE-HTTP-401'
  if (status === 403) return 'ADP-GOLD-PROBE-HTTP-403'
  if (status === 404) return 'ADP-GOLD-PROBE-HTTP-404'
  if (status >= 400 && status < 500) return 'ADP-GOLD-PROBE-HTTP-4XX'
  if (status >= 500 && status < 600) return 'ADP-GOLD-PROBE-HTTP-5XX'
  return 'ADP-GOLD-PROBE-HTTP-UNEXPECTED'
}

export async function GET(request) {
  const env = process.env
  const until = Date.parse(env.ADP_GOLD_PROBE_UNTIL ?? '')
  const now = Date.now()
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== BRANCH ||
      !Number.isFinite(until) || now >= until || until > now + 15 * 60_000 ||
      !tokenMatches(request.headers.get('x-adp-gold-probe'), env.ADP_GOLD_PROBE_TOKEN)) {
    return answer(404, 'ADP-GOLD-PROBE-DISABLED')
  }
  if (env.ADP_PREVIEW_SUPABASE_REF !== EXPECTED_REF ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${EXPECTED_REF}.supabase.co` ||
      env.PLAYBACK_HEARTBEATS_ENABLED !== 'false' ||
      env.MUX_METADATA_SYNC_ENABLED !== 'false' || env.ADP_UPLOADS_ENABLED !== 'false' ||
      !env.SUPABASE_SERVICE_ROLE_KEY) {
    return answer(503, 'ADP-GOLD-PROBE-CONFIG')
  }
  try {
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/adp_integrity_release?select=version,ready&singleton=eq.true&limit=1`
    const response = await fetch(url, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) return answer(503, dataApiFailureCode(response.status))
    const rows = await response.json()
    return Array.isArray(rows) && rows.length === 1 && rows[0].version === 121 && rows[0].ready === true
      ? answer(200, 'ADP-GOLD-PROBE-OK') : answer(503, 'ADP-GOLD-PROBE-READINESS')
  } catch {
    return answer(503, 'ADP-GOLD-PROBE-NETWORK')
  }
}
