import test from 'node:test'
import assert from 'node:assert/strict'
import { syncMuxUpload } from '../../src/lib/mux-duration-sync.mjs'

function dependencies({ upload = { status: 'asset_created', asset_id: 'asset-1' }, asset = {
  id: 'asset-1', status: 'ready', duration: 123.4567,
  playback_ids: [{ id: 'signed-playback', policy: 'signed' }],
}, video = { id: 'video-1' }, rpc = { data: { ok: true, duration: 123.457, durationMatched: false }, error: null }, uploadFailure, assetFailure, databaseFailure } = {}) {
  let rpcCalls = 0
  return {
    mux: {
      video: {
        uploads: { retrieve: async () => { if (uploadFailure) throw uploadFailure; return upload } },
        assets: { retrieve: async () => { if (assetFailure) throw assetFailure; return asset } },
      },
    },
    adminDb: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: video, error: null }) }) }) }),
      rpc: async () => { rpcCalls += 1; if (databaseFailure) throw databaseFailure; return rpc },
      get rpcCalls() { return rpcCalls },
    },
  }
}

test('Mux retrieval failure is reported per video without throwing', async () => {
  const deps = dependencies({ uploadFailure: new Error('network unavailable') })
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, false)
  assert.match(result.reason, /Mux could not be reached/)
  assert.equal(deps.adminDb.rpcCalls, 0)
})

test('not-ready asset does not verify duration', async () => {
  const deps = dependencies({ asset: { id: 'asset-1', status: 'preparing', duration: 120, playback_ids: [] } })
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, false)
  assert.match(result.reason, /still processing/)
  assert.equal(deps.adminDb.rpcCalls, 0)
})

test('missing signed playback or invalid duration does not verify', async (t) => {
  await t.test('missing playback', async () => {
    const deps = dependencies({ asset: { id: 'asset-1', status: 'ready', duration: 10, playback_ids: [] } })
    assert.equal((await syncMuxUpload('upload-1', deps)).verified, false)
    assert.equal(deps.adminDb.rpcCalls, 0)
  })
  await t.test('invalid duration', async () => {
    const deps = dependencies({ asset: { id: 'asset-1', status: 'ready', duration: 0, playback_ids: [{ id: 'p', policy: 'signed' }] } })
    assert.equal((await syncMuxUpload('upload-1', deps)).verified, false)
    assert.equal(deps.adminDb.rpcCalls, 0)
  })
})

test('database synchronization error leaves duration unverified', async () => {
  const deps = dependencies({ rpc: { data: null, error: { code: 'XX000', message: 'write failed' } } })
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, false)
  assert.match(result.reason, /could not be saved/)
  assert.equal(deps.adminDb.rpcCalls, 1)
})

test('database transport exception is reported as a database failure, not a Mux failure', async () => {
  const deps = dependencies({ databaseFailure: new Error('database timeout') })
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, false)
  assert.match(result.reason, /database/)
  assert.doesNotMatch(result.reason, /Mux could not be reached/)
  assert.equal(deps.adminDb.rpcCalls, 1)
})

test('valid ready Mux metadata is verified only after the database RPC succeeds', async () => {
  const deps = dependencies()
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, true)
  assert.equal(result.duration, 123.457)
  assert.equal(result.durationMatched, false)
  assert.equal(deps.adminDb.rpcCalls, 1)
})

test('video lookup failure does not call the verification RPC', async () => {
  const deps = dependencies({ video: null })
  const result = await syncMuxUpload('upload-1', deps)
  assert.equal(result.verified, false)
  assert.equal(deps.adminDb.rpcCalls, 0)
})
