import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { createHash, randomUUID } from 'crypto'
import { syncMuxUpload } from '@/lib/mux-duration-sync.mjs'
import { assertDashboardSize, collectPages } from '@/lib/admin-pages.mjs'
import { identifyError, sanitizeApiError } from '@/lib/error-registry.mjs'
import { sameOriginMutation } from '@/lib/api-errors.mjs'
import { createOrResumeUpload } from '@/lib/upload-lifecycle.mjs'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }

async function authorize() {
  const member = await getMember()
  return member?.is_admin ? member : null
}

export async function GET() {
  const correlationId = randomUUID()
  let admin
  try { admin = await authorize() } catch { return NextResponse.json(sanitizeApiError('admin_data_unavailable', correlationId), { status: 503, headers: privateHeaders }) }
  if (!admin) return NextResponse.json(sanitizeApiError('forbidden', correlationId), { status: 403, headers: privateHeaders })

  let profiles, allowed, videos, progress, completions, verifiedCompletions
  try {
    [profiles, allowed, videos, progress, completions, verifiedCompletions] = await Promise.all([
      collectPages(async (from, to) => await adminDb.from('profiles').select('*', { count: 'exact' }).order('id').range(from, to)),
      collectPages(async (from, to) => await adminDb.from('authorized_discord_ids').select('*', { count: 'exact' }).order('discord_id').range(from, to)),
      collectPages(async (from, to) => await adminDb.from('videos').select('*', { count: 'exact' }).order('id').range(from, to)),
      collectPages(async (from, to) => await adminDb.from('user_video_progress').select('*', { count: 'exact' }).order('user_id').order('video_id').range(from, to)),
      collectPages(async (from, to) => await adminDb.from('completion_records').select('user_id,video_id,completed_at,method', { count: 'exact' }).order('user_id').order('video_id').range(from, to)),
      collectPages(async (from, to) => await adminDb.from('verified_completion_records').select('user_id,video_id,asset_id,duration_seconds,completed_at,validator_version,asset_identity,reset_at,verified_at', { count: 'exact' }).order('user_id').order('video_id').order('asset_id').order('duration_seconds').range(from, to)),
    ])
    assertDashboardSize(profiles.length, videos.length)
  } catch {
    console.error('[ADP admin] Dashboard pagination or data query failed', { correlationId, errorId: 'ADP-ADM-002' })
    return NextResponse.json(sanitizeApiError('admin_data_unavailable', correlationId), { status: 503, headers: privateHeaders })
  }
  return NextResponse.json({
    profiles,
    allowed,
    videos,
    progress,
    completions,
    verifiedCompletions,
    lastActivity: Object.fromEntries(profiles.map((profile) => [profile.id, profile.last_seen_at])),
  }, { headers: privateHeaders })
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mux-sync'), videoId: z.string().uuid() }),
  z.object({ action: z.literal('access'), discordId: z.string().regex(/^\d{5,25}$/), enabled: z.boolean() }),
  z.object({ action: z.literal('video-create'), operationId: z.string().uuid(), videoId: z.string().uuid(), title: z.string().min(1).max(180), description: z.string().max(4000).default('') }),
  z.object({ action: z.literal('upload-review'), operationId: z.string().uuid() }),
  z.object({ action: z.literal('video-update'), videoId: z.string().uuid(), title: z.string().min(1).max(180), description: z.string().max(4000), thumbnailUrl: z.string().url().nullable().optional(), published: z.boolean(), sortOrder: z.number().int() }),
  z.object({ action: z.literal('video-delete'), videoId: z.string().uuid() }),
  z.object({ action: z.literal('progress-reset'), userId: z.string().uuid(), videoId: z.string().uuid() }),
  z.object({ action: z.literal('progress-complete'), userId: z.string().uuid(), videoId: z.string().uuid() }),
])

export async function POST(request: Request) {
  const correlationId = randomUUID()
  const fail = (code: string, status = identifyError(code).status) => NextResponse.json(sanitizeApiError(code, correlationId), { status, headers: privateHeaders })
  if (!sameOriginMutation(request)) return fail('forbidden')
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return fail('invalid_content_type')
  }
  try {
    const response = await handleAdminPost(request, correlationId)
    if (response.ok) {
      Object.entries(privateHeaders).forEach(([key, value]) => response.headers.set(key, value))
      return response
    }
    const body = await response.json().catch(() => ({}))
    const code = typeof body.error === 'string' ? body.error : 'admin_unavailable'
    const registered = identifyError(code)
    const status = registered.errorId === 'ADP-ADM-099' ? 503 : response.status
    const payload = sanitizeApiError(code, correlationId)
    if (code === 'whitelist_write_failed' && (body.operation === 'add' || body.operation === 'remove')) return NextResponse.json({ ...payload, operation: body.operation }, { status, headers: privateHeaders })
    return NextResponse.json(payload, { status, headers: privateHeaders })
  } catch {
    console.error('[ADP admin] mutation failed unexpectedly', { correlationId, errorId: 'ADP-ADM-099' })
    return fail('admin_unavailable')
  }
}

async function handleAdminPost(request: Request, correlationId: string) {
  const member = await authorize()
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  let result: any = { ok: true }

  if (input.action === 'upload-review') {
    const { data: intent, error } = await adminDb.from('adp_upload_intents')
      .select('video_id,state,mux_upload_id').eq('operation_id', input.operationId).maybeSingle()
    if (error) return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 503 })
    if (!intent) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) return NextResponse.json({ error: 'mux_credentials_missing' }, { status: 503 })
    const { mux } = await import('@/lib/mux')
    let matches = 0, inspected = 0
    try {
      // SDK auto-pagination is exhaustive. Do not infer absence from one page.
      for await (const upload of mux.video.uploads.list({ limit: 100 })) {
        if (++inspected > 10000) throw Error('provider inventory exceeds review bound')
        if (upload.new_asset_settings?.passthrough === intent.video_id) matches++
      }
    } catch {
      return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, videoId: intent.video_id, state: intent.state,
      providerMatches: matches, boundUploadPresent: Boolean(intent.mux_upload_id),
      manualReviewRequired: matches !== 1 || !['waiting','asset_created'].includes(intent.state) })
  }

  if (input.action === 'mux-sync') {
    // This write path is opt-in separately from both dashboard access and playback.
    // It stays closed unless an administrator explicitly enables it after approval.
    if (process.env.MUX_METADATA_SYNC_ENABLED !== 'true') {
      return NextResponse.json({ error: 'metadata_sync_disabled' }, { status: 503 })
    }
    // This service-role readiness RPC is available only while Release 1.2.1
    // is ready and the database playback gate remains off. Keep it separate
    // from playback readiness so metadata verification cannot open playback.
    const readiness = await adminDb.rpc('adp_metadata_sync_integrity_version')
    if (readiness.error || readiness.data !== 121) return NextResponse.json({ error: 'metadata_sync_unavailable' }, { status: 503 })
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET || !process.env.MUX_SIGNING_KEY_ID || !process.env.MUX_SIGNING_PRIVATE_KEY) {
      return NextResponse.json({ error: 'mux_credentials_missing' }, { status: 503 })
    }
    const { data: video, error: videoError } = await adminDb
      .from('videos').select('mux_upload_id,duration_precision_verified').eq('id', input.videoId).maybeSingle()
    if (videoError) {
      console.error('[ADP admin] Video metadata sync lookup failed', { correlationId, errorId: 'ADP-ADM-002', databaseCode: videoError.code ?? null })
      return NextResponse.json({ error: 'admin_data_unavailable' }, { status: 503 })
    }
    if (!video?.mux_upload_id) return NextResponse.json({ error: 'mux_upload_missing' }, { status: 404 })
    if (video.duration_precision_verified) return NextResponse.json({ error: 'metadata_already_verified' }, { status: 409 })
    const { mux } = await import('@/lib/mux')
    const { data: intent, error: intentError } = await adminDb.from('adp_upload_intents')
      .select('operation_id,video_id,mux_upload_id').eq('video_id', input.videoId).maybeSingle()
    if (intentError) return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 503 })
    if (intent) {
      const providerUpload = await mux.video.uploads.retrieve(video.mux_upload_id).catch(() => null)
      if (intent.video_id !== input.videoId || intent.mux_upload_id !== video.mux_upload_id ||
          providerUpload?.id !== video.mux_upload_id || providerUpload?.new_asset_settings?.passthrough !== input.videoId) {
        return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 409 })
      }
    }
    const syncResult = await syncMuxUpload(video.mux_upload_id, { mux, adminDb, correlationId })
    if (syncResult.verified) {
      if (intent) {
        const finalized = await adminDb.rpc('adp_finalize_upload_intent_qc026', { p_actor_id: member.id, p_video_id: input.videoId })
        if (finalized.error || finalized.data !== true) {
          console.error('[ADP admin] Upload metadata saved but intent finalization requires review',
            { correlationId, errorId: 'ADP-ADM-019', databaseCode: finalized.error?.code ?? null })
          return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 503 })
        }
      }
      const { error: auditError } = await adminDb.from('admin_audit_log').insert({
        admin_id: member.id, action: 'mux-sync', details: { videoId: input.videoId, verified: true },
      })
      if (auditError) console.error('[ADP admin] Mux sync audit log write failed', { correlationId, errorId: 'ADP-ADM-099', databaseCode: auditError.code ?? null })
    }
    return NextResponse.json(syncResult.verified ? syncResult : { ...syncResult, error: 'mux_sync_failed' }, { status: syncResult.verified ? 200 : 502 })
  }

  if (input.action === 'access') {
    if (!input.enabled && input.discordId === process.env.INITIAL_ADMIN_DISCORD_ID) return NextResponse.json({ error: 'bootstrap_admin_locked' }, { status: 400 })
    if (input.enabled) {
      const { error } = await adminDb.from('authorized_discord_ids').upsert({ discord_id: input.discordId, added_by: member.discord_id }, { onConflict: 'discord_id' })
      if (error) {
        console.error('[ADP admin] Whitelist write failed', { correlationId, errorId: 'ADP-ADM-009', operation: 'add', databaseCode: error.code ?? null })
        return NextResponse.json({ error: 'whitelist_write_failed', operation: 'add', databaseCode: error.code || null }, { status: 503 })
      }
    } else {
      const { error } = await adminDb.from('authorized_discord_ids').delete().eq('discord_id', input.discordId)
      if (error) {
        console.error('[ADP admin] Whitelist write failed', { correlationId, errorId: 'ADP-ADM-009', operation: 'remove', databaseCode: error.code ?? null })
        return NextResponse.json({ error: 'whitelist_write_failed', operation: 'remove', databaseCode: error.code || null }, { status: 503 })
      }
    }
    result.discordId = input.discordId
  }
  if (input.action === 'video-create') {
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) return NextResponse.json({ error: 'mux_credentials_missing' }, { status: 503 })
    const payloadHash = createHash('sha256').update(JSON.stringify([input.title, input.description])).digest('hex')
    const operation = { operationId: input.operationId, videoId: input.videoId, actorId: member.id, payloadHash,
      title: input.title, description: input.description }
    // The authenticated RPC reserves both the unpublished video and intent in
    // one transaction. No provider request is allowed before that succeeds.
    const ledger = {
      async reserve() {
        const { data, error } = await adminDb.rpc('adp_reserve_upload_intent_qc026', {
          p_actor_id: member.id, p_operation_id: input.operationId, p_video_id: input.videoId, p_request_hash: payloadHash,
          p_title: input.title, p_description: input.description,
        })
        if (error) throw error
        return data
      },
      async claim() {
        const { data, error } = await adminDb.rpc('adp_claim_upload_intent_qc026', { p_actor_id: member.id, p_operation_id: input.operationId })
        if (error) throw error
        return data === true
      },
      async setTarget(_row: unknown, upload: { id: string; url: string; expiresAt: string }) {
        const { data, error } = await adminDb.rpc('adp_bind_upload_intent_qc026', {
          p_actor_id: member.id, p_operation_id: input.operationId, p_upload_id: upload.id,
          p_upload_url: upload.url, p_expires_at: upload.expiresAt,
        })
        if (error || data !== true) throw error ?? Error('upload binding rejected')
      },
      async markReview() {
        const { error } = await adminDb.rpc('adp_mark_upload_review_qc026', { p_actor_id: member.id, p_operation_id: input.operationId })
        if (error) throw error
      },
    }
    try {
      const { mux } = await import('@/lib/mux')
      const target = await createOrResumeUpload({ ledger, mux: {
        async create(videoId: string) {
          const upload = await mux.video.uploads.create({ cors_origin: new URL(request.url).origin,
            timeout: 3600, new_asset_settings: { playback_policies: ['signed'], video_quality: 'basic', passthrough: videoId } })
          if (!upload?.id || !upload.url) throw Error('provider response incomplete')
          const verified = await mux.video.uploads.retrieve(upload.id)
          if (verified?.id !== upload.id || verified?.status !== 'waiting' ||
              verified?.new_asset_settings?.passthrough !== videoId) throw Error('provider upload identity mismatch')
          return { id: upload.id, url: upload.url, expiresAt: new Date(Date.now() + 3540_000).toISOString() }
        },
      } }, operation)
      if (target.action !== 'reuse') return NextResponse.json({ error: 'upload_requires_reconciliation' }, { status: 409 })
      return NextResponse.json({ ok: true, videoId: target.videoId, uploadId: target.uploadId, uploadUrl: target.uploadUrl })
    } catch (error) {
      const databaseCode = (error as { code?: string })?.code ?? null
      const conflict = databaseCode === '23505' || (error as Error)?.message === 'upload intent conflict'
      console.error('[ADP admin] Upload intent unavailable', { correlationId, errorId: 'ADP-ADM-008', databaseCode })
      return NextResponse.json({ error: conflict ? 'upload_intent_conflict' : 'upload_requires_reconciliation' }, { status: conflict ? 409 : 503 })
    }
  }
  if (input.action === 'video-update') {
    if (input.published) {
      const { data: video, error: readinessError } = await adminDb.from('videos').select('playback_id,duration_seconds,duration_precision_verified').eq('id', input.videoId).maybeSingle()
      if (readinessError) {
        console.error('[ADP admin] Video publish readiness check failed', { correlationId, errorId: 'ADP-ADM-017', databaseCode: readinessError.code ?? null })
        return NextResponse.json({ error: 'video_publish_check_failed', databaseCode: readinessError.code || null }, { status: 503 })
      }
      if (!video) return NextResponse.json({ error: 'video_not_found' }, { status: 404 })
      if (!video.playback_id || !Number(video.duration_seconds) || !video.duration_precision_verified) {
        return NextResponse.json({ error: 'video_metadata_unverified' }, { status: 409 })
      }
    }
    const { data: updatedVideo, error } = await adminDb.from('videos').update({ title: input.title, description: input.description, thumbnail_url: input.thumbnailUrl, published: input.published, sort_order: input.sortOrder }).eq('id', input.videoId).select('id').maybeSingle()
    if (error) {
      console.error('[ADP admin] Video record update failed', { correlationId, errorId: 'ADP-ADM-006', databaseCode: error.code ?? null })
      return NextResponse.json({ error: 'video_record_update_failed', databaseCode: error.code || null }, { status: 503 })
    }
    if (!updatedVideo) return NextResponse.json({ error: 'video_not_found' }, { status: 404 })
  }
  if (input.action === 'video-delete') {
    // A provider delete cannot participate in the database transaction, and
    // deleting the video cascades into training evidence. Use unpublish for now.
    return NextResponse.json({ error: 'video_delete_disabled', reason: 'Unpublish this video to retain training history.' }, { status: 409 })
  }
  if (input.action === 'progress-reset' || input.action === 'progress-complete') {
    const client = await createClient()
    const { data, error } = await client.rpc('adp_admin_progress', {p_user_id:input.userId,p_video_id:input.videoId,p_action:input.action})
    if (error) {
      console.error('[ADP admin] progress RPC failed', { correlationId, errorId: 'ADP-ADM-020', databaseCode: error.code ?? null })
      return NextResponse.json({ error: 'admin_progress_unavailable' }, { status: 503 })
    }
    return NextResponse.json(data)
  }
  const { error: auditError } = await adminDb.from('admin_audit_log').insert({ admin_id: member.id, action: input.action, details: input })
  if (auditError) console.error('[ADP admin] audit log write failed', { correlationId, errorId: 'ADP-ADM-099', action: input.action, databaseCode: auditError.code ?? null })
  return NextResponse.json(result)
}
