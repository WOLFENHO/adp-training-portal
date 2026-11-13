import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { playbackToken } from '@/lib/mux'
import { getPlaybackGate } from '@/lib/playback-gate'
import { z } from 'zod'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getMember()
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const gate = await getPlaybackGate()
  if (!gate.enabled) {
    const reason = gate.error === 'playback_maintenance'
      ? 'Verified playback is temporarily disabled.'
      : 'The playback readiness check did not pass.'
    return NextResponse.json({ error: gate.error, reason }, { status: 503 })
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  const { data: video, error } = await adminDb
    .from('videos')
    .select('playback_id,published,duration_seconds')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[ADP playback] Playback-token video lookup failed', { code: error.code })
    return NextResponse.json({ error: 'video_unavailable' }, { status: 503 })
  }
  if (!video?.playback_id || (!video.published && !member.is_admin)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  try {
    return NextResponse.json({ token: await playbackToken(video.playback_id, video.duration_seconds) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch {
    return NextResponse.json({ error: 'playback_signing_unavailable' }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
