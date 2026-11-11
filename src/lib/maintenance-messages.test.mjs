import test from 'node:test'
import assert from 'node:assert/strict'
import { adminActionMessage, adminDashboardMessage, adminMutationMessage, playbackSessionMessage } from './maintenance-messages.mjs'

test('playback session errors explain disabled maintenance and readiness checks', () => {
  assert.match(playbackSessionMessage('playback_maintenance'), /temporarily disabled/i)
  assert.match(playbackSessionMessage('playback_schema_unavailable'), /Release 1\.2/i)
  assert.equal(playbackSessionMessage('other', 'fallback'), 'fallback')
})

test('admin dashboard errors explain data failures and preserve authorization feedback', () => {
  assert.match(adminDashboardMessage('admin_data_unavailable'), /database credentials and logs/i)
  assert.match(adminDashboardMessage('forbidden'), /administrator access is required/i)
})

test('Mux metadata sync remains explicitly disabled until separately approved', () => {
  assert.match(adminActionMessage('metadata_sync_disabled'), /disabled.*separately approved/i)
  assert.match(adminActionMessage('schema_maintenance'), /Release 1\.2/i)
  assert.equal(adminActionMessage('other'), null)
})

test('administrator write failures identify the operation and useful recovery details', () => {
  assert.match(adminMutationMessage('access', {error:'whitelist_write_failed',operation:'add',databaseCode:'42501'}, 503), /could not add.*42501/i)
  assert.match(adminMutationMessage('video-create', {error:'video_record_create_failed',databaseCode:'42501'}, 503), /orphaned upload/i)
  assert.match(adminMutationMessage('access', {error:'invalid_request'}, 400), /digits only/i)
  assert.match(adminMutationMessage('video-update', {error:'video_metadata_unverified'}, 409), /left unpublished.*separately approved/i)
})
