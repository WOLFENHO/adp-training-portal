import test from 'node:test'
import assert from 'node:assert/strict'
import { bindPauseBufferEvents, transitionRecoveryKind } from '../../src/lib/player-lifecycle.mjs'
import { summarizeVideoProgress } from '../../src/lib/progress-status.mjs'

test('native pause maps to pause and waiting maps to buffering', () => {
  const media = new EventTarget()
  media.currentTime = 41.25
  const seen = []
  const unbind = bindPauseBufferEvents(media, {
    onPause: (kind, position) => seen.push({ kind, position }),
    onBuffering: (kind, position) => seen.push({ kind, position }),
  })
  media.dispatchEvent(new Event('pause'))
  media.currentTime = 42.5
  media.dispatchEvent(new Event('waiting'))
  unbind()
  media.dispatchEvent(new Event('pause'))
  assert.deepEqual(seen, [
    { kind: 'pause', position: 41.25 },
    { kind: 'buffering', position: 42.5 },
  ])
})

test('rejected stop transitions recover only from confirmed media time', () => {
  const confirmedPosition = 17.125
  const rejectedPosition = 29.75
  for (const kind of ['pause', 'buffering']) {
    const recoveryKind = transitionRecoveryKind(kind, false, true, false)
    assert.equal(recoveryKind, kind)
    const request = { kind: recoveryKind, position: confirmedPosition, isPlaying: false }
    assert.notEqual(request.position, rejectedPosition)
    assert.equal(transitionRecoveryKind(kind, true, true, false), null)
    assert.equal(transitionRecoveryKind(kind, false, true, true), null)
  }
})

test('historical completion is not reported as verified completion', () => {
  const summary = summarizeVideoProgress(
    { asset_id: 'asset', duration_seconds: 100, duration_precision_verified: true },
    { verified_watched_seconds: 0, completed_at: '2026-01-01T00:00:00Z' },
    [],
    [{ completed_at: '2026-01-01T00:00:00Z' }],
  )
  assert.equal(summary.status, 'historical_completed')
  assert.equal(summary.percent, 0)
  assert.equal(summary.currentVerified, false)
})


test('delayed rejected stop cannot recover after a newer playback intent', () => {
 for (const kind of ['pause','buffering']) {
 assert.equal(transitionRecoveryKind(kind,false,true,false,1,2),null)
 assert.equal(transitionRecoveryKind(kind,false,true,false,2,2),kind)
 }
})

test('completion requires the exact current asset identity and excludes reset/unbound records',()=>{
 const video={asset_id:'asset-a',duration_seconds:100,duration_precision_verified:true}
 const row={asset_id:'asset-a',duration_seconds:100,validator_version:12,completed_at:'2026-01-01T00:00:00Z'}
 for(const variation of [{}, {asset_identity:'asset-b:100.000:12'}, {asset_identity:'asset-a:100.000:12',reset_at:'2026-02-01T00:00:00Z'}]) {
  const result=summarizeVideoProgress(video,null,[{...row,...variation}],[])
  assert.equal(result.currentVerified,false);assert.equal(result.status,'historical_completed')
 }
 assert.equal(summarizeVideoProgress(video,null,[{...row,asset_identity:'asset-a:100.000:12'}],[]).currentVerified,false)
 assert.equal(summarizeVideoProgress(video,null,[{...row,asset_identity:'asset-a:100.000:12',verified_at:'2026-01-01T00:00:00Z'}],[]).currentVerified,true)
})
