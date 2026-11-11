// Keep privileged Preview clients closed until the target project is explicit.
export function assertSupabaseIsolation(env) {
  if (env.VERCEL_ENV !== 'preview') return
  const expected = env.ADP_PREVIEW_SUPABASE_REF
  if (!expected || !/^[a-z0-9]{20}$/.test(expected)) {
    throw new Error('Preview Supabase project identity is not configured')
  }
  let url
  try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL) } catch {
    throw new Error('Preview Supabase URL is invalid')
  }
  if (url.protocol !== 'https:' || url.hostname !== `${expected}.supabase.co`) {
    throw new Error('Preview Supabase project identity mismatch')
  }
}
