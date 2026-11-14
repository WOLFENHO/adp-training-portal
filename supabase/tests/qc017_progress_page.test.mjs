import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichProgressPage } from '../../src/lib/admin-progress-page.mjs'

const user = '00000000-0000-4000-8000-000000000001'
const video = '00000000-0000-4000-8000-000000000002'
const progress = { user_id: user, video_id: video, verified_watched_seconds: 50, completed_at: null }
const identity = 'asset:100.000:12'
function db(rows) { return { from(table) { return {
  select() { return this }, in() { return this }, limit() { return Promise.resolve({ data: rows[table] ?? [], error: null }) },
} } } }

test('QC-017 progress page distinguishes verified completion from historical records', async () => {
  const rows = {
    profiles: [{ id: user, username: 'Member' }], videos: [{ id: video, title: 'Lesson', asset_id: 'asset', duration_seconds: 100, duration_precision_verified: true }],
    completion_records: [{ user_id: user, video_id: video, completed_at: '2026-01-01' }],
    verified_completion_records: [{ user_id: user, video_id: video, asset_id: 'asset', duration_seconds: 100, validator_version: 12, asset_identity: identity, completed_at: '2026-01-02', reset_at: null }],
  }
  const result = await enrichProgressPage(db(rows), [progress])
  assert.equal(result[0].status, 'verified_completed')
  assert.equal(result[0].percent, 100)
  assert.equal(result[0].historicalCompletedAt, '2026-01-01')
  assert.equal(result[0].verifiedCompletedAt, '2026-01-02')
  rows.verified_completion_records[0].asset_identity = 'stale:100.000:12'
  const stale = await enrichProgressPage(db(rows), [progress])
  assert.equal(stale[0].status, 'in_progress')
  assert.equal(stale[0].percent, 50)
  assert.equal(stale[0].verifiedCompletedAt, null)
})

test('QC-017 empty progress page does not query related tables', async () => {
  assert.deepEqual(await enrichProgressPage({ from() { throw Error('unexpected query') } }, []), [])
})
