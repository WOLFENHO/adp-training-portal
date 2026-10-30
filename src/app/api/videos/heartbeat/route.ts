import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { adminDb } from '@/lib/supabase/admin'

const schema = z.object({
  sessionId: z.string().uuid(),
  requestId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  clientSequence: z.number().int().positive().safe(),
  position: z.number().finite().min(0),
  isPlaying: z.boolean(),
  kind: z.enum(['play', 'pause', 'buffering', 'periodic', 'seek', 'complete']),
})

export async function POST(request: Request) {
  const requestReceivedAt = new Date().toISOString()
  const member = await getMember()
  if (!member) {
    return NextResponse.json({ accepted: false, code: 'forbidden', error: 'Member session missing or access revoked.' }, { status: 403 })
  }

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ accepted: false, code: 'invalid_request', error: 'Invalid heartbeat request.', details: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  if (process.env.PLAYBACK_HEARTBEATS_ENABLED !== 'true') {
    return NextResponse.json({ accepted: false, code: 'playback_maintenance', error: 'Verified playback is temporarily unavailable.' }, { status: 503 })
  }
  const rpcStartedAt = new Date().toISOString()
  const supabase = await createClient()
  const { data: release, error: releaseError } = await supabase.rpc('adp_playback_integrity_version')
  if (releaseError || release !== 12) {
    console.error('[ADP playback] Release 1.2 schema is unavailable', { code: releaseError?.code, message: releaseError?.message, version: release ?? null })
    return NextResponse.json({ accepted: false, code: 'playback_schema_unavailable', error: 'Verified playback is disabled until the Release 1.2 database migration is complete.' }, { status: 503 })
  }
  const { data, error } = await supabase.rpc('record_playback_heartbeat_r12', {
    p_session_id: input.sessionId,
    p_request_id: input.requestId,
    p_expected_version: input.expectedVersion,
    p_client_sequence: input.clientSequence,
    p_position: input.position,
    p_is_playing: input.isPlaying,
    p_kind: input.kind,
  })
  const responseAt = new Date().toISOString()

  if (error) {
    const { data: session } = await adminDb
      .from('playback_sessions')
      .select('user_id,video_id,session_version,last_event_sequence,last_position,last_heartbeat_at,active_since,is_playing,active,playback_budget_seconds,started_at')
      .eq('id', input.sessionId)
      .eq('user_id', member.id)
      .maybeSingle()
    const status = error.message === 'not authorized' ? 403 : error.message === 'client_upgrade_required' ? 426 : error.message.includes('session_') ? 409 : 503
    console.error('[ADP playback] heartbeat RPC error', {
      requestId: input.requestId,
      clientSequence: input.clientSequence,
      expectedVersion: input.expectedVersion,
      sessionId: input.sessionId,
      userId: member.id,
      kind: input.kind,
      requestedPosition: input.position,
      isPlaying: input.isPlaying,
      requestReceivedAt,
      rpcStartedAt,
      responseAt,
      status,
      databaseCode: error.code,
      databaseMessage: error.message,
      databaseDetails: error.details,
      session: session ?? { valid: false },
    })
    return NextResponse.json({ accepted: false, code: error.message, error: error.message }, { status })
  }

  const result: any = data ?? { accepted: false, code: 'empty_rpc_response', error: 'Heartbeat RPC returned no result.' }
  if (result.accepted !== true) {
    const status = ['stale_version', 'stale_event', 'request_id_reused', 'session_expired', 'session_inactive', 'sequence_out_of_range'].includes(result.code) ? 409 : 422
    console.warn('[ADP playback] heartbeat rejected', {
      requestId: input.requestId,
      clientSequence: input.clientSequence,
      expectedVersion: input.expectedVersion,
      sessionId: input.sessionId,
      userId: member.id,
      kind: input.kind,
      requestedPosition: input.position,
      isPlaying: input.isPlaying,
      requestReceivedAt,
      rpcStartedAt,
      responseAt,
      status,
      rejection: result,
    })
    return NextResponse.json(result, { status })
  }

  console.info('[ADP playback] heartbeat accepted', {
    requestId: input.requestId,
    clientSequence: input.clientSequence,
    expectedVersion: input.expectedVersion,
    acceptedVersion: result.version,
    sessionId: input.sessionId,
    userId: member.id,
    kind: input.kind,
    requestedPosition: input.position,
    acceptedPosition: result.acceptedPosition,
    isPlaying: input.isPlaying,
    requestReceivedAt,
    rpcStartedAt,
    databaseRequestAt: result.requestAt,
    databaseTransactionStartedAt: result.transactionStartedAt,
    previousHeartbeatAt: result.previousHeartbeatAt,
    responseAt,
    previousPosition: result.previousPosition,
    serverElapsed: result.serverElapsed,
    eligibleBudget: result.budgetSeconds,
    lastEventSequence: result.lastEventSequence,
    intervalInserted: result.intervalInserted,
    intervalCount: result.intervals?.length,
    confirmedPercent: result.percent,
    duplicate: result.duplicate,
  })
  return NextResponse.json(result)
}
