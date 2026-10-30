import test from 'node:test'
import assert from 'node:assert/strict'
import { bindPauseBufferEvents, requiresServerPlayActivation, transitionRecoveryKind } from '../../src/lib/player-lifecycle.mjs'
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

test('rejected stop transitions recover only from confirmed media time and gate resume', () => {
  const confirmedPosition = 17.125
  const rejectedPosition = 29.75
  for (const kind of ['pause', 'buffering']) {
    const recoveryKind = transitionRecoveryKind(kind, false, true, false)
    assert.equal(recoveryKind, kind)
    const request = { kind: recoveryKind, position: confirmedPosition, isPlaying: false }
    assert.notEqual(request.position, rejectedPosition)
    assert.equal(requiresServerPlayActivation(true, true), true)
    assert.equal(transitionRecoveryKind(kind, true, true, false), null)
    assert.equal(transitionRecoveryKind(kind, false, true, true), null)
    assert.equal(requiresServerPlayActivation(false, false), true)
    assert.equal(requiresServerPlayActivation(true, false), false)
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

