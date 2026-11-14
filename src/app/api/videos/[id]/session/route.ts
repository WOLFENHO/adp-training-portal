import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { safeSessionRpcError, sameOriginMutation } from '@/lib/api-errors.mjs'

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID()
  const fail = (status: number, code: string, errorId: string, reason: string) =>
    NextResponse.json({ error: code, errorId, correlationId, reason }, { status, headers })

  if (!sameOriginMutation(request)) return fail(403, 'forbidden', 'ADP-AUTH-003', 'Request origin rejected.')
  let member
  try { member = await getMember() } catch {
    console.error('[ADP playback] session authorization unavailable', { correlationId, errorId: 'ADP-PRG-004' })
    return fail(503, 'session_unavailable', 'ADP-PRG-004', 'Playback session could not be started. Try again.')
  }
  if (!member) return fail(403, 'forbidden', 'ADP-AUTH-003', 'Member session missing or access revoked.')
  if (process.env.PLAYBACK_HEARTBEATS_ENABLED !== 'true') return fail(503, 'playback_maintenance', 'ADP-PRG-001', 'Verified playback is temporarily disabled.')

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return fail(400, 'invalid_request', 'ADP-API-001', 'Invalid video identifier.')
  try {
    const supabase = await createClient()
    const { data: release, error: releaseError } = await supabase.rpc('adp_playback_integrity_version')
    if (releaseError || release !== 121) {
      console.error('[ADP playback] session release unavailable', { correlationId, errorId: 'ADP-PRG-005', databaseCode: releaseError?.code ?? null })
      return fail(503, 'playback_schema_unavailable', 'ADP-PRG-005', 'Verified playback is temporarily unavailable.')
    }
    const { data, error } = await supabase.rpc('start_playback_session_r12', { p_video_id: id })
    if (error) {
      const mapped = safeSessionRpcError(error)
      console.error('[ADP playback] session creation rejected', { correlationId, errorId: mapped.errorId, databaseCode: error.code ?? null })
      return fail(mapped.status, mapped.code, mapped.errorId, 'Playback session could not be started. Reopen the lesson or try again.')
    }
    if (!data || typeof data !== 'object' || typeof data.sessionId !== 'string') {
      console.error('[ADP playback] invalid session response', { correlationId, errorId: 'ADP-PRG-004' })
      return fail(503, 'session_unavailable', 'ADP-PRG-004', 'Playback session could not be started. Try again.')
    }
    return NextResponse.json(data, { headers })
  } catch {
    console.error('[ADP playback] session service failure', { correlationId, errorId: 'ADP-PRG-004' })
    return fail(503, 'session_unavailable', 'ADP-PRG-004', 'Playback session could not be started. Try again.')
  }
}
