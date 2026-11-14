import test from 'node:test'
import assert from 'node:assert/strict'
import { planUploadOperation, reconcileUploadCandidates, findOrphanUploads } from '../../src/lib/upload-intent.mjs'

const intent = { operationId: 'op-1', actorId: 'admin-1', payloadHash: 'hash-1', videoId: 'video-1', status: 'waiting', uploadId: 'mux-1', uploadUrl: 'https://mux.invalid/signed', expiresAt: '2026-11-13T12:00:00Z' }
const now = new Date('2026-11-13T11:00:00Z')

test('QC-026 lost creation response returns the same durable upload target', () => {
  assert.deepEqual(planUploadOperation(intent, { operationId: 'op-1', actorId: 'admin-1', payloadHash: 'hash-1' }, now), { action: 'reuse', videoId: 'video-1', uploadId: 'mux-1', uploadUrl: 'https://mux.invalid/signed' })
})

test('QC-026 conflicting replay and creating lease never create a second Mux target', () => {
  assert.equal(planUploadOperation(intent, { operationId: 'op-1', actorId: 'admin-2', payloadHash: 'hash-1' }, now).action, 'conflict')
  assert.equal(planUploadOperation(intent, { operationId: 'op-1', actorId: 'admin-1', payloadHash: 'changed' }, now).action, 'conflict')
  assert.equal(planUploadOperation({ ...intent, status: 'creating', uploadId: null, uploadUrl: null }, { operationId: 'op-1', actorId: 'admin-1', payloadHash: 'hash-1' }, now).action, 'reconcile')
  assert.equal(planUploadOperation({ ...intent, expiresAt: '2026-11-13T10:00:00Z' }, { operationId: 'op-1', actorId: 'admin-1', payloadHash: 'hash-1' }, now).action, 'reconcile')
})

test('QC-026 reconciliation binds one exact passthrough match and quarantines ambiguity', () => {
  const uploads = [{ id: 'mux-1', status: 'waiting', new_asset_settings: { passthrough: 'video-1' } }, { id: 'other', status: 'waiting', new_asset_settings: { passthrough: 'another-video' } }]
  assert.deepEqual(reconcileUploadCandidates('video-1', uploads), { action: 'bind', uploadId: 'mux-1' })
  assert.equal(reconcileUploadCandidates('video-1', [uploads[0], { ...uploads[0], id: 'mux-2' }]).action, 'manual_review')
  assert.equal(reconcileUploadCandidates('video-1', []).action, 'manual_review')
  assert.equal(reconcileUploadCandidates('video-1', [{ ...uploads[0], status: 'timed_out' }]).action, 'manual_review')
  assert.equal(reconcileUploadCandidates('video-1', [{ ...uploads[0], status: 'asset_created', asset_id: 'asset-A' }]).action, 'bind')
  assert.equal(reconcileUploadCandidates('video-1', [{ ...uploads[0], status: 'asset_created' }]).action, 'manual_review')
})

test('QC-026 orphan discovery is read-only and never proposes deletion', () => {
  const report = findOrphanUploads([{ id: 'mux-1', new_asset_settings: { passthrough: 'video-1' }, status: 'asset_created' }, { id: 'mux-2', new_asset_settings: { passthrough: 'video-2' }, status: 'waiting' }], new Set(['video-1']))
  assert.deepEqual(report, [{ uploadId: 'mux-2', videoId: 'video-2', status: 'waiting' }])
})
