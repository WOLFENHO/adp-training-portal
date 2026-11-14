import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { sameOriginMutation, sanitizeHeartbeatRejection } from '@/lib/api-errors.mjs'

const schema = z.object({
  sessionId: z.string().uuid(), requestId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(), clientSequence: z.number().int().positive().safe(),
  position: z.number().finite().min(0), isPlaying: z.boolean(),
  kind: z.enum(['play', 'pause', 'buffering', 'periodic', 'seek', 'complete']),
})
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
const knownRpcErrors = new Set(['not authorized', 'client_upgrade_required', 'session_expired', 'session_inactive', 'session_not_found', 'session_version_mismatch'])
const conflictCodes = new Set(['stale_version', 'stale_event', 'request_id_reused', 'session_expired', 'session_inactive', 'sequence_out_of_range'])

export async function POST(request: Request) {
  const correlationId = randomUUID()
  const fail = (status: number, code: string, error: string) => NextResponse.json({ accepted: false, code, error, errorId: code === 'forbidden' ? 'ADP-AUTH-003' : 'ADP-PRG-006', correlationId }, { status, headers })
  if (!sameOriginMutation(request)) return fail(403, 'forbidden', 'Request origin rejected.')
  let member
  try { member = await getMember() } catch {
    console.error('[ADP playback] heartbeat authorization unavailable', { correlationId, code: 'heartbeat_unavailable' })
    return fail(503, 'heartbeat_unavailable', 'Progress could not be confirmed. Try again.')
  }
  if (!member) return fail(403, 'forbidden', 'Member session missing or access revoked.')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return fail(400, 'invalid_request', 'Invalid heartbeat request.')
  if (process.env.PLAYBACK_HEARTBEATS_ENABLED !== 'true') return fail(503, 'playback_maintenance', 'Verified playback is temporarily unavailable.')

  try {
  const supabase = await createClient()
  const { data: release, error: releaseError } = await supabase.rpc('adp_playback_integrity_version')
  if (releaseError || release !== 121) {
    console.error('[ADP playback] release unavailable', { correlationId, code: 'playback_schema_unavailable', databaseCode: releaseError?.code ?? null })
    return fail(503, 'playback_schema_unavailable', 'Verified playback is temporarily unavailable.')
  }
  const input = parsed.data
  const { data, error } = await supabase.rpc('record_playback_heartbeat_r12', {
    p_session_id: input.sessionId, p_request_id: input.requestId,
    p_expected_version: input.expectedVersion, p_client_sequence: input.clientSequence,
    p_position: input.position, p_is_playing: input.isPlaying, p_kind: input.kind,
  })
  if (error) {
    const code = knownRpcErrors.has(error.message) ? error.message : 'heartbeat_unavailable'
    const status = code === 'not authorized' ? 403 : code === 'client_upgrade_required' ? 426 : code.startsWith('session_') ? 409 : 503
    console.error('[ADP playback] heartbeat RPC error', { correlationId, code, databaseCode: error.code ?? null })
    return fail(status, code, code === 'heartbeat_unavailable' ? 'Progress could not be saved. Retry when your connection is stable.' : code)
  }
  if (!data || typeof data !== 'object') {
    console.error('[ADP playback] empty heartbeat result', { correlationId, code: 'empty_rpc_response' })
    return fail(503, 'empty_rpc_response', 'Progress could not be confirmed. Please retry.')
  }
  if (data.accepted !== true) {
    const receipt = sanitizeHeartbeatRejection(data, correlationId)
    return NextResponse.json(receipt, { status: conflictCodes.has(receipt.code) ? 409 : 422, headers })
  }
  return NextResponse.json(data, { headers })
  } catch {
    console.error('[ADP playback] heartbeat service failure', { correlationId, code: 'heartbeat_unavailable' })
    return fail(503, 'heartbeat_unavailable', 'Progress could not be confirmed. Retry this request.')
  }
}
