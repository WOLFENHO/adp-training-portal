/** Decisions for a durable, database-backed upload ledger; no provider writes here. */
export function planUploadOperation(existing, request, now = new Date()) {
  if (!existing) return { action: 'reserve' }
  if (existing.operationId !== request.operationId || existing.actorId !== request.actorId || existing.payloadHash !== request.payloadHash) return { action: 'conflict' }
  if (existing.status === 'asset_created') return { action: 'complete', videoId: existing.videoId, uploadId: existing.uploadId }
  if (existing.status === 'waiting' && existing.uploadId && existing.uploadUrl &&
      Date.parse(existing.expiresAt) > now.getTime()) {
    return { action: 'reuse', videoId: existing.videoId, uploadId: existing.uploadId, uploadUrl: existing.uploadUrl }
  }
  return { action: 'reconcile' }
}

/** List must be exhaustive; an empty result is never authority to create anew. */
export function reconcileUploadCandidates(videoId, uploads) {
  const matches = uploads.filter(upload => upload.new_asset_settings?.passthrough === videoId)
  if (matches.length !== 1) return { action: 'manual_review' }
  const match = matches[0]
  if (typeof match.id !== 'string' || !match.id ||
      !['waiting', 'asset_created'].includes(match.status) ||
      (match.status === 'asset_created' && !match.asset_id)) return { action: 'manual_review' }
  return { action: 'bind', uploadId: match.id }
}

/** Candidate review only. Never delete a provider upload or asset automatically. */
export function findOrphanUploads(uploads, recordedVideoIds) {
  return uploads.filter(upload => {
    const videoId = upload.new_asset_settings?.passthrough
    return typeof videoId === 'string' && videoId.length > 0 && !recordedVideoIds.has(videoId)
  }).map(upload => ({ uploadId: upload.id, videoId: upload.new_asset_settings.passthrough, status: upload.status }))
}
