import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleVerifiedPercent, intervalMarkers } from '../../src/lib/player-display.mjs'

test('QC-010 rounded near-complete coverage never displays 100 without verified completion', () => {
  assert.equal(visibleVerifiedPercent(100, false), 99.9)
  assert.equal(visibleVerifiedPercent(99.96, false), 99.9)
  assert.equal(visibleVerifiedPercent(99.96, true), 100)
  assert.equal(visibleVerifiedPercent(45, false), 45)
})

test('QC-016 timeline markers scale with intervals rather than video seconds', () => {
  const markers = intervalMarkers([{ start_seconds: 0, end_seconds: 30 }, { start_seconds: 3600, end_seconds: 3610 }], 10800)
  assert.equal(markers.length, 2)
  assert.equal(markers[0].left, 0)
  assert.equal(markers[1].width, 10 / 10800 * 100)
})

test('QC-016 intervals clamp to media bounds and invalid ranges cannot draw', () => {
  const markers = intervalMarkers([{ start_seconds: -5, end_seconds: 2 }, { start_seconds: 9, end_seconds: 20 }, { start_seconds: 5, end_seconds: 4 }], 10)
  assert.deepEqual(markers, [{ left: 0, width: 20 }, { left: 90, width: 10 }])
})
