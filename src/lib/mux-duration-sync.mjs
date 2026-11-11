/**
 * Synchronize only Mux metadata that reports a ready asset, a signed playback
 * ID, and a finite positive duration. The database RPC sets verification and
 * reconciles historical coverage atomically.
 */
export async function syncMuxUpload(uploadId, { mux, adminDb }) {
  let upload
  let asset
  try {
    upload = await mux.video.uploads.retrieve(uploadId)
    if (!upload.asset_id) return { uploadId, status: upload.status, ready: false, verified: false, reason: 'Mux has not created an asset yet.' }
    asset = await mux.video.assets.retrieve(upload.asset_id)
  } catch (error) {
    console.error('[ADP admin] Mux duration retrieval failed', {
      uploadId, reason: error instanceof Error ? error.message : String(error),
    })
    return { uploadId, status: 'unavailable', ready: false, verified: false, reason: 'Mux could not be reached. Retry this video sync later.' }
  }
  if (asset.status !== 'ready') return { uploadId, status: asset.status, ready: false, verified: false, reason: 'Mux asset is still processing.' }

  const playback = asset.playback_ids?.find((item) => item.policy === 'signed')
  const duration = Number(asset.duration)
  if (!playback?.id) return { uploadId, status: asset.status, ready: true, verified: false, reason: 'Mux did not return a signed playback ID.' }
  if (!Number.isFinite(duration) || duration <= 0) return { uploadId, status: asset.status, ready: true, verified: false, reason: 'Mux did not return a valid positive duration.' }

  try {
    const { data: video, error: videoError } = await adminDb.from('videos').select('id').eq('mux_upload_id', uploadId).maybeSingle()
    if (videoError || !video?.id) {
      console.error('[ADP admin] Mux duration video lookup failed', { uploadId, code: videoError?.code, message: videoError?.message })
      return { uploadId, status: asset.status, ready: true, verified: false, reason: 'The matching video record could not be found.' }
    }
    const { data, error } = await adminDb.rpc('adp_sync_verified_duration', {
      p_video_id: video.id,
      p_asset_id: asset.id,
      p_playback_id: playback.id,
      p_duration: duration,
    })
    if (error || !data?.ok) {
      console.error('[ADP admin] Mux duration synchronization database update failed', {
        uploadId, assetId: asset.id, code: error?.code, message: error?.message,
      })
      return { uploadId, status: asset.status, ready: true, verified: false, reason: 'The verified duration could not be saved to the database.' }
    }
    return { uploadId, status: asset.status, ready: true, verified: true, duration: data.duration, durationMatched: data.durationMatched }
  } catch (error) {
    console.error('[ADP admin] Mux duration database synchronization threw', {
      uploadId, reason: error instanceof Error ? error.message : String(error),
    })
    return { uploadId, status: asset.status, ready: true, verified: false, reason: 'The verified duration could not be saved to the database.' }
  }
}
