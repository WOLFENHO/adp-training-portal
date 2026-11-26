import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadsEnabled } from '../../src/lib/upload-gate.mjs'
test('uploads default closed and open only for exact true', () => {
 for (const value of [undefined, '', 'false', 'TRUE', '1']) assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: value }), false)
 assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true' }), true)
})
