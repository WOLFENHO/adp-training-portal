import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrResumeUpload, reviewOrphanUploads, reviewUpload } from '../../src/lib/upload-lifecycle.mjs'

function fixture() {
  const intents = new Map(), videos = new Map(), uploads = []
  let creates = 0
  const ledger = {
    async reserve(request) { let row = intents.get(request.operationId); if (!row) { row = { ...request, videoId: request.videoId, status: 'reserved' }; intents.set(request.operationId, row); videos.set(request.videoId, { published: false }) } return row },
    async claim(row) { if (row.status !== 'reserved') return false; row.status = 'creating'; return true },
    async setTarget(row, upload) { row.status = 'waiting'; row.uploadId = upload.id; row.uploadUrl = upload.url; row.expiresAt = upload.expiresAt },
    async markReview(row) { row.status = 'needs_reconciliation' },
  }
  const mux = { async create(videoId) { creates++; const upload = { id: `upload-${creates}`, url: `https://upload.test/${creates}`, expiresAt: '2099-01-01', new_asset_settings: { passthrough: videoId }, status: 'waiting' }; uploads.push(upload); return upload }, async list() { return uploads } }
  return { ledger, mux, intents, videos, uploads, get creates() { return creates } }
}
const request = { operationId: '00000000-0000-4000-8000-000000000001', actorId: '00000000-0000-4000-8000-000000000002', payloadHash: 'a'.repeat(64), videoId: '00000000-0000-4000-8000-000000000003' }

test('QC-026 retry and lost HTTP response reuse one provider target', async () => {
  const state = fixture()
  const first = await createOrResumeUpload(state, request)
  const retry = await createOrResumeUpload(state, request)
  assert.equal(first.uploadId, retry.uploadId)
  assert.equal(state.creates, 1)
  assert.equal(state.videos.get(request.videoId).published, false)
})

test('QC-026 lost provider creation response and expired lease cannot create again automatically', async () => {
  const state = fixture()
  state.mux.create = async videoId => { state.uploads.push({ id: 'upload-lost', new_asset_settings: { passthrough: videoId } }); throw Error('provider response lost') }
  await assert.rejects(createOrResumeUpload(state, request), /review/)
  await assert.rejects(createOrResumeUpload(state, request), /review/)
  assert.equal(state.intents.get(request.operationId).status, 'needs_reconciliation')
})

test('QC-026 URL expiry, conflicting actor and orphan review never delete provider assets', async () => {
  const state = fixture()
  await createOrResumeUpload(state, request)
  await assert.rejects(createOrResumeUpload(state, { ...request, actorId: 'other' }), /conflict/)
  state.intents.get(request.operationId).expiresAt = '2000-01-01'
  await assert.rejects(createOrResumeUpload(state, request), /review/)
  const orphans = await reviewOrphanUploads(state.mux, new Set())
  assert.equal(orphans.length, 1)
  assert.equal(state.uploads.length, 1)
})

test('QC-026 expired creation lease and incomplete transfer require existing-target recovery', async () => {
  const state = fixture()
  state.intents.set(request.operationId, { ...request, status: 'creating', leaseUntil: '2000-01-01' })
  await assert.rejects(createOrResumeUpload(state, request), /review/)
  assert.equal(state.creates, 0)
  state.intents.clear()
  const first = await createOrResumeUpload(state, request)
  const retry = await createOrResumeUpload(state, request)
  assert.equal(first.uploadId, retry.uploadId)
  assert.equal(state.creates, 1)
})

test('QC-026 reconciliation scans every page and refuses ambiguous matches', async () => {
  const matches = [1, 2].map(n => ({ id: `upload-${n}`, new_asset_settings: { passthrough: request.videoId } }))
  const mux = { async list(cursor) { return cursor ? { items: [matches[1]], nextCursor: null } : { items: [matches[0]], nextCursor: 'page-2' } } }
  assert.deepEqual(await reviewUpload(mux, request.videoId), { action: 'manual_review' })
  assert.equal((await reviewOrphanUploads(mux, new Set())).length, 2)
})
