import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldHideControls } from '../../src/lib/player-display.mjs'

test('QC-021 keyboard focus keeps playback controls visible', () => {
  assert.equal(shouldHideControls(true, true), false)
  assert.equal(shouldHideControls(true, false), true)
  assert.equal(shouldHideControls(false, false), false)
})
