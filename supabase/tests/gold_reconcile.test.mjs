import test from 'node:test'
import assert from 'node:assert/strict'
import { planRecoveredUpload } from '../../src/lib/upload-intent.mjs'

const now = new Date('2026-11-19T12:00:00Z')
const row = { videoId: 'video-1', status: 'needs_reconciliation', uploadId: null, createdAt: '2026-11-19T11:55:00Z' }
const upload = { id: 'mux-1', status: 'waiting', url: 'https://upload.example/target',
  timeout: 3600, cors_origin: 'https://preview.example', new_asset_settings: { passthrough: 'video-1', playback_policies: ['signed'] } }

test('recover exactly one recent waiting provider upload without creating another', () => {
  assert.deepEqual(planRecoveredUpload(row, [upload], now, 'https://preview.example'), { action: 'bind', uploadId: upload.id,
    uploadUrl: upload.url, expiresAt: '2026-11-19T12:54:00.000Z' })
  for (const candidates of [[], [upload, { ...upload, id: 'mux-2' }], [{ ...upload, status: 'asset_created' }],
    [{ ...upload, timeout: 60 }], [{ ...upload, url: null }],
    [{ ...upload, new_asset_settings: { passthrough: 'other' } }]]) {
    assert.deepEqual(planRecoveredUpload(row, candidates, now, 'https://preview.example'), { action: 'manual_review' })
  }
  assert.deepEqual(planRecoveredUpload({ ...row, uploadId: 'mux-2' }, [upload], now, 'https://preview.example'), { action: 'manual_review' })
  assert.deepEqual(planRecoveredUpload({ ...row, status: 'asset_created' }, [upload], now, 'https://preview.example'), { action: 'manual_review' })
  assert.deepEqual(planRecoveredUpload(row, [{ ...upload, cors_origin: 'https://other.example' }], now, 'https://preview.example'), { action: 'manual_review' })
})
