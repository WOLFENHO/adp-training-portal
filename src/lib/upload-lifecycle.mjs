import { findOrphanUploads, planUploadOperation, reconcileUploadCandidates } from './upload-intent.mjs'

/** Isolated adapter: ledger.reserve and ledger.claim must be atomic database transactions. */
export async function createOrResumeUpload({ ledger, mux }, request, now = new Date()) {
  const row = await ledger.reserve(request)
  const decision = planUploadOperation(row, request, now)
  if (decision.action === 'conflict') throw Error('upload intent conflict')
  if (decision.action === 'reuse' || decision.action === 'complete') return decision
  if (row.status !== 'reserved') throw Error('upload requires reconciliation review')
  if (!await ledger.claim(row)) throw Error('upload requires reconciliation review')
  let upload
  try {
    upload = await mux.create(row.videoId)
    await ledger.setTarget(row, upload)
  } catch {
    try { await ledger.markReview(row) } catch { /* creating lease still blocks another provider create */ }
    throw Error('upload requires reconciliation review')
  }
  return { action: 'reuse', videoId: row.videoId, uploadId: upload.id, uploadUrl: upload.url }
}

export async function listUploadPages(mux) {
  const all = [], visited = new Set()
  let cursor = null
  do {
    const result = await mux.list(cursor)
    const items = Array.isArray(result) ? result : result.items
    if (!Array.isArray(items) || all.length + items.length > 10000) throw Error('provider listing incomplete')
    all.push(...items)
    cursor = Array.isArray(result) ? null : result.nextCursor ?? null
    if (cursor && visited.has(cursor)) throw Error('provider listing loop')
    if (cursor) visited.add(cursor)
  } while (cursor)
  return all
}

/** Read-only candidate output; binding needs a separately authorized atomic operation. */
export async function reviewUpload(mux, videoId) { return reconcileUploadCandidates(videoId, await listUploadPages(mux)) }
export async function reviewOrphanUploads(mux, recordedVideoIds) { return findOrphanUploads(await listUploadPages(mux), recordedVideoIds) }
