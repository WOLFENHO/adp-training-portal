import test from 'node:test'
import assert from 'node:assert/strict'
import { trainingSequence } from '../../src/lib/training-progression.mjs'

const first = { id: 'a', sort_order: 0, published: true, asset_id: 'asset-a', duration_seconds: 16.7, duration_precision_verified: true }
const next = { id: 'b', sort_order: 1, published: true, asset_id: 'asset-b', duration_seconds: 80, duration_precision_verified: true }
const proof = { video_id: 'a', asset_id: 'asset-a', duration_seconds: 16.7, validator_version: 12,
  asset_identity: 'asset-a:16.700:12', verified_at: '2026-11-19T12:00:00Z', reset_at: null }

test('module progression needs current asset-bound verified completion', () => {
  const videos = [next, first]
  assert.deepEqual(trainingSequence(videos, []), { a: true, b: false })
  assert.deepEqual(trainingSequence(videos, [proof]), { a: true, b: true })
  for (const altered of [{ ...proof, reset_at: '2026-11-19T13:00:00Z' },
    { ...proof, asset_id: 'previous' }, { ...proof, asset_identity: null },
    { ...proof, validator_version: 11 }, { ...proof, duration_seconds: 16.651 },
    { ...proof, verified_at: null }]) assert.equal(trainingSequence(videos, [altered]).b, false)
  assert.equal(trainingSequence(videos, [{ video_id: 'a', completed_at: proof.verified_at, method: 'playback' }]).b, false)
  assert.equal(trainingSequence(videos, [proof, { video_id: 'b', completed_at: proof.verified_at, method: 'admin_override' }]).b, true)
})

test('published modules use stable sort order and preserve interruption state', () => {
  const third = { ...next, id: 'c', sort_order: 1 }
  assert.deepEqual(trainingSequence([third, next, first], [proof]), { a: true, b: true, c: false })
  assert.deepEqual(trainingSequence([third, next, first], [proof, { video_id: 'b', verified_watched_seconds: 79 }]),
    { a: true, b: true, c: false })
  assert.deepEqual(trainingSequence([first, { ...next, published: false }, third], [proof]), { a: true, c: true })
})
