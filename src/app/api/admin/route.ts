import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getMember } from '@/lib/auth'
import { adminDb } from '@/lib/supabase/admin'
import { mux } from '@/lib/mux'
import { randomUUID } from 'crypto'
import { syncMuxUpload } from '@/lib/mux-duration-sync.mjs'

async function authorize() {
  const member = await getMember()
  return member?.is_admin ? member : null
}

// The database RPC updates verification and interval reconciliation atomically.
const syncUpload = (uploadId: string) => syncMuxUpload(uploadId, { mux, adminDb })

export async function GET(request: Request) {
  const admin = await authorize()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const uploadId = new URL(request.url).searchParams.get('uploadId')
  if (uploadId) return NextResponse.json(await syncUpload(uploadId))

  const { data: pending, error: pendingError } = await adminDb
    .from('videos').select('id,mux_upload_id,duration_precision_verified')
    .eq('duration_precision_verified', false).not('mux_upload_id', 'is', null)
  if (pendingError) {
    console.error('[ADP admin] Could not load unverified videos', { code: pendingError.code, message: pendingError.message })
  }
  const syncResults = await Promise.all((pending ?? []).map((video) =>
    video.mux_upload_id ? syncUpload(video.mux_upload_id) : Promise.resolve({
      uploadId: '', status: 'unavailable', ready: false, verified: false, reason: 'Mux upload ID is missing.',
    }),
  ))

  const [profilesResult, allowedResult, videosResult, progressResult, completionsResult, verifiedCompletionsResult] = await Promise.all([
    adminDb.from('profiles').select('*').order('username'),
    adminDb.from('authorized_discord_ids').select('*'),
    adminDb.from('videos').select('*').order('sort_order'),
    adminDb.from('user_video_progress').select('*'),
    adminDb.from('completion_records').select('user_id,video_id,completed_at,method'),
    adminDb.from('verified_completion_records').select('user_id,video_id,asset_id,duration_seconds,completed_at,validator_version'),
  ])
  const queryErrors = [profilesResult, allowedResult, videosResult, progressResult, completionsResult, verifiedCompletionsResult]
    .filter((result) => result.error)
    .map((result) => ({ code: result.error?.code, message: result.error?.message }))
  if (queryErrors.length) {
    console.error('[ADP admin] Dashboard data query failed', { errors: queryErrors })
    return NextResponse.json({ error: 'Some administration data could not be loaded.' }, { status: 503 })
  }
  const profiles = profilesResult.data ?? []
  return NextResponse.json({
    profiles,
    allowed: allowedResult.data ?? [],
    videos: videosResult.data ?? [],
    progress: progressResult.data ?? [],
    completions: completionsResult.data ?? [],
    verifiedCompletions: verifiedCompletionsResult.data ?? [],
    durationSyncResults: syncResults,
    durationSyncQueryError: pendingError ? 'Unverified videos could not be listed for synchronization.' : null,
    lastActivity: Object.fromEntries(profiles.map((profile) => [profile.id, profile.last_seen_at])),
  })
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('access'), discordId: z.string().regex(/^\d{5,25}$/), enabled: z.boolean() }),
  z.object({ action: z.literal('video-create'), title: z.string().min(1).max(180), description: z.string().max(4000).default('') }),
  z.object({ action: z.literal('video-update'), videoId: z.string().uuid(), title: z.string().min(1).max(180), description: z.string().max(4000), thumbnailUrl: z.string().url().nullable().optional(), published: z.boolean(), sortOrder: z.number().int() }),
  z.object({ action: z.literal('video-delete'), videoId: z.string().uuid() }),
  z.object({ action: z.literal('progress-reset'), userId: z.string().uuid(), videoId: z.string().uuid() }),
  z.object({ action: z.literal('progress-complete'), userId: z.string().uuid(), videoId: z.string().uuid() }),
])

export async function POST(request: Request) {
  const member = await authorize()
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data
  let result: any = { ok: true }

  if (input.action === 'access') {
    if (!input.enabled && input.discordId === process.env.INITIAL_ADMIN_DISCORD_ID) return NextResponse.json({ error: 'The bootstrap administrator cannot be removed.' }, { status: 400 })
    if (input.enabled) {
      const { error } = await adminDb.from('authorized_discord_ids').upsert({ discord_id: input.discordId, added_by: member.discord_id }, { onConflict: 'discord_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    } else {
      const { error } = await adminDb.from('authorized_discord_ids').delete().eq('discord_id', input.discordId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    result.discordId = input.discordId
  }
  if (input.action === 'video-create') {
    const videoId = randomUUID()
    const upload = await mux.video.uploads.create({ cors_origin: process.env.NEXT_PUBLIC_APP_URL!, new_asset_settings: { playback_policies: ['signed'], video_quality: 'basic', passthrough: videoId } })
    const { error } = await adminDb.from('videos').insert({ id: videoId, title: input.title, description: input.description, published: false, sort_order: 999, mux_upload_id: upload.id, duration_seconds: 0 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    result = { ok: true, videoId, uploadId: upload.id, uploadUrl: upload.url }
  }
  if (input.action === 'video-update') {
    if (input.published) {
      const { data: video } = await adminDb.from('videos').select('playback_id,duration_seconds,duration_precision_verified').eq('id', input.videoId).maybeSingle()
      if (!video?.playback_id || !video.duration_seconds || !video.duration_precision_verified) return NextResponse.json({ error: 'Sync the ready Mux duration before publishing this video.' }, { status: 400 })
    }
    const { error } = await adminDb.from('videos').update({ title: input.title, description: input.description, thumbnail_url: input.thumbnailUrl, published: input.published, sort_order: input.sortOrder }).eq('id', input.videoId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (input.action === 'video-delete') {
    const { data: video } = await adminDb.from('videos').select('asset_id').eq('id', input.videoId).maybeSingle()
    if (video?.asset_id) await mux.video.assets.delete(video.asset_id)
    const { error } = await adminDb.from('videos').delete().eq('id', input.videoId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (input.action === 'progress-reset') {
    const { error: intervalError } = await adminDb.from('watched_intervals').delete().eq('user_id', input.userId).eq('video_id', input.videoId)
    if (intervalError) return NextResponse.json({ error: intervalError.message }, { status: 400 })
    const { error: progressError } = await adminDb.from('user_video_progress').delete().eq('user_id', input.userId).eq('video_id', input.videoId)
    if (progressError) return NextResponse.json({ error: progressError.message }, { status: 400 })
    const { error: completionError } = await adminDb.from('completion_records').delete().eq('user_id', input.userId).eq('video_id', input.videoId)
    if (completionError) return NextResponse.json({ error: completionError.message }, { status: 400 })
    const { error: verifiedCompletionError } = await adminDb.from('verified_completion_records').delete().eq('user_id', input.userId).eq('video_id', input.videoId)
    if (verifiedCompletionError) return NextResponse.json({ error: verifiedCompletionError.message }, { status: 400 })
  }
  if (input.action === 'progress-complete') {
    const { data: video } = await adminDb.from('videos').select('duration_seconds').eq('id', input.videoId).single()
    if (!video?.duration_seconds) return NextResponse.json({ error: 'video not ready' }, { status: 400 })
    const completedAt = new Date().toISOString()
    const { error } = await adminDb.from('completion_records').upsert({ user_id: input.userId, video_id: input.videoId, completed_at: completedAt, method: 'admin_override', admin_id: member.id }, { onConflict: 'user_id,video_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const { data: existingProgress } = await adminDb.from('user_video_progress').select('completed_at,verified_watched_seconds').eq('user_id', input.userId).eq('video_id', input.videoId).maybeSingle()
    const { error: progressError } = await adminDb.from('user_video_progress').upsert({ user_id: input.userId, video_id: input.videoId, watched_seconds: video.duration_seconds, verified_watched_seconds: existingProgress?.verified_watched_seconds ?? 0, completed_at: existingProgress?.completed_at ?? completedAt, updated_at: completedAt }, { onConflict: 'user_id,video_id' })
    if (progressError) return NextResponse.json({ error: progressError.message }, { status: 400 })
  }
  const { error: auditError } = await adminDb.from('admin_audit_log').insert({ admin_id: member.id, action: input.action, details: input })
  if (auditError) console.error('[ADP admin] audit log write failed', { action: input.action, code: auditError.code, message: auditError.message })
  return NextResponse.json(result)
}
