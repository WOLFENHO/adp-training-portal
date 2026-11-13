import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHeartbeatRejection } from '../../src/lib/api-errors.mjs'

test('QC-018 rejected RPC receipt cannot return arbitrary diagnostic or signed token fields', () => {
  const receipt = sanitizeHeartbeatRejection({ accepted: false, code: 'stale_version', error: 'secret DB payload', version: 2, lastEventSequence: 4, acceptedPosition: 3, serverIsPlaying: false, playbackToken: 'signed-token', privateData: { email: 'fixture@example.test' } }, 'correlation')
  assert.deepEqual(receipt, { accepted: false, code: 'stale_version', error: 'Playback event was not accepted.', errorId: 'ADP-PRG-006', correlationId: 'correlation', version: 2, lastEventSequence: 4, acceptedPosition: 3, serverIsPlaying: false })
})
