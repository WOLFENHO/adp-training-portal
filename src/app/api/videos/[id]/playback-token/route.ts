import { NextResponse } from 'next/server'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { playbackToken } from '@/lib/mux'
import { getPlaybackGate } from '@/lib/playback-gate'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID()
  const fail = (status: number, error: string, reason?: string) => NextResponse.json({ error, ...(reason ? { reason } : {}), errorId: 'ADP-PRG-007', correlationId }, { status, headers })
  if (request.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'forbidden')
  const member = await getMember()
  if (!member) return fail(403, 'forbidden')

  let gate
  try { gate = await getPlaybackGate() } catch { return fail(503, 'playback_schema_unavailable') }
  if (!gate.enabled) {
    const reason = gate.error === 'playback_maintenance'
      ? 'Verified playback is temporarily disabled.'
      : 'The playback readiness check did not pass.'
    return fail(503, gate.error, reason)
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return fail(400, 'invalid_request')
  let video, error
  try { ({ data: video, error } = await adminDb
    .from('videos')
    .select('playback_id,published,duration_seconds')
    .eq('id', id)
    .maybeSingle()) } catch { return fail(503, 'video_unavailable') }
  if (error) {
    console.error('[ADP playback] Playback-token video lookup failed', { code: error.code })
    return fail(503, 'video_unavailable')
  }
  if (!video?.playback_id || (!video.published && !member.is_admin)) {
    return fail(404, 'not_found')
  }

  try {
    return NextResponse.json({ token: await playbackToken(video.playback_id, video.duration_seconds) }, { headers })
  } catch {
    return fail(503, 'playback_signing_unavailable')
  }
}
