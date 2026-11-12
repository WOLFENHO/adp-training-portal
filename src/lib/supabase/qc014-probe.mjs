import { timingSafeEqual } from 'node:crypto'

export const REHEARSAL_REF = 'nqqarmkgnuvvqnvnodyc'
const PREVIEW_ORIGIN = 'https://adp-training-portal-git-audit-qc-batch1-isolated-uther.vercel.app'
const result = (ok, code) => ({ expectedProjectRef: REHEARSAL_REF, ok, code })

export function checkProbeAccess(env, presented) {
  const until = Date.parse(env.ADP_QC_PROBE_UNTIL ?? '')
  const token = env.ADP_QC_PROBE_TOKEN
  if (env.VERCEL_ENV !== 'preview' || env.ADP_QC_PROBE_ENABLED !== 'true' || !Number.isFinite(until) ||
      Date.now() >= until || until > Date.now() + 15 * 60_000 ||
      !token || token.length < 24 || !presented) return result(false, 'ADP-QC014-DISABLED')
  const expected = Buffer.from(token)
  const actual = Buffer.from(presented)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return result(false, 'ADP-QC014-DISABLED')
  return result(true, 'ADP-QC014-AUTHORIZED')
}

export async function probeIdentity(env, presented, readRelease) {
  if (!checkProbeAccess(env, presented).ok) return result(false, 'ADP-QC014-DISABLED')
  if (env.ADP_PREVIEW_SUPABASE_REF !== REHEARSAL_REF ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${REHEARSAL_REF}.supabase.co` ||
      env.NEXT_PUBLIC_APP_URL !== PREVIEW_ORIGIN ||
      env.MUX_TOKEN_ID !== 'DISABLED_QC014' || env.MUX_SIGNING_KEY_ID !== 'DISABLED_QC014' ||
      env.MUX_TOKEN_SECRET || env.MUX_SIGNING_PRIVATE_KEY ||
      env.PLAYBACK_HEARTBEATS_ENABLED !== 'false' || env.MUX_METADATA_SYNC_ENABLED !== 'false' ||
      !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY === 'DISABLED_PENDING_REHEARSAL_CREDENTIAL') {
    return result(false, 'ADP-QC014-CONFIG')
  }
  try {
    const release = await readRelease(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    return release?.version === 121 && release?.ready === true
      ? result(true, 'ADP-QC014-OK') : result(false, 'ADP-QC014-READINESS')
  } catch {
    return result(false, 'ADP-QC014-KEY-REJECTED')
  }
}
