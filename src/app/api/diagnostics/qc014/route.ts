import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkProbeAccess, probeIdentity } from '@/lib/supabase/qc014-probe.mjs'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }
export async function GET(request: Request) {
  const token = request.headers.get('x-adp-qc-probe') ?? ''
  if (!checkProbeAccess(process.env, token).ok) {
    return NextResponse.json({ expectedProjectRef: 'nqqarmkgnuvvqnvnodyc', ok: false, code: 'ADP-QC014-DISABLED' }, { status: 404, headers })
  }
  const outcome = await probeIdentity(process.env, token, async (url, key) => {
    const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error } = await client.from('adp_integrity_release').select('version,ready').eq('singleton', true).abortSignal(AbortSignal.timeout(5000)).single()
    if (error) throw error
    return data
  })
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 503, headers })
}
