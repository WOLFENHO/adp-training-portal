import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { playbackToken } from '@/lib/mux'
import { getPlaybackGate } from '@/lib/playback-gate'

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
  const { data: video, error } = await adminDb
    .from('videos')
    .select('playback_id,published')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[ADP playback] Playback-token video lookup failed', { code: error.code })
    return NextResponse.json({ error: 'video_unavailable' }, { status: 503 })
  }
  if (!video?.playback_id || (!video.published && !member.is_admin)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ token: await playbackToken(video.playback_id) })
}
