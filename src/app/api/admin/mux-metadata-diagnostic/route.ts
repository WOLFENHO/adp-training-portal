import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const videoId = '21859f19-efa0-4680-bbb1-d2d6a4a125a1'

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  const expiresAt = Date.parse(process.env.ADP_MUX_DIAGNOSTIC_UNTIL ?? '')
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return reply({}, 404)

  const member = await getMember()
  if (!member?.is_admin) return reply({}, 403)
  if (new URL(request.url).search) return reply({}, 400)

  try {
    const { data, error } = await adminDb.from('videos').select('mux_upload_id').eq('id', videoId).maybeSingle()
    if (error) return reply({}, 503)
    if (!data?.mux_upload_id) return reply({}, 404)

    const { mux } = await import('@/lib/mux')
    const upload = await mux.video.uploads.retrieve(data.mux_upload_id)
    if (!upload.asset_id) return reply({}, 409)

    const asset = await mux.video.assets.retrieve(upload.asset_id)
    const signed = asset.playback_ids?.find(({ policy }) => policy === 'signed')
    const duration = asset.duration
    if (asset.status !== 'ready' || !signed?.id || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      return reply({}, 409)
    }

    return reply({ assetId: asset.id, signedPlaybackId: signed.id, duration })
  } catch {
    return reply({}, 502)
  }
}
