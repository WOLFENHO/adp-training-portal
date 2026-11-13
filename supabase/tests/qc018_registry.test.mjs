import test from 'node:test'
import assert from 'node:assert/strict'
import { identifyError, sanitizeApiError } from '../../src/lib/error-registry.mjs'

test('QC-018 known errors have stable IDs, status and bounded user messages', () => {
  for (const code of ['forbidden', 'invalid_request', 'playback_maintenance', 'session_unavailable', 'admin_data_unavailable', 'video_delete_disabled', 'video_record_create_failed', 'whitelist_write_failed']) {
    const entry = identifyError(code)
    assert.match(entry.errorId, /^ADP-[A-Z]+-\d{3}$/)
    assert.ok(entry.status >= 400 && entry.status <= 599)
    assert.ok(entry.message.length > 0 && entry.message.length < 180)
  }
})

test('QC-018 API error envelope discards raw database text, identifiers, and signed URLs', () => {
  const envelope = sanitizeApiError('video_record_create_failed', 'fixed-correlation', { details: 'private@example.test', databaseCode: 'XX000', uploadUrl: 'signed-secret' })
  assert.deepEqual(envelope, { error: 'video_record_create_failed', errorId: 'ADP-ADM-008', correlationId: 'fixed-correlation', reason: 'Video setup could not finish. Ask an administrator to review the pending upload.' })
  assert.doesNotMatch(JSON.stringify(envelope), /private|signed-secret|XX000/)
})
