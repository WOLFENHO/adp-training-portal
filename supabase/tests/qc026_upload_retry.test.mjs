import test from 'node:test'
import assert from 'node:assert/strict'
import { transferExistingUpload } from '../../src/lib/upload-transfer.mjs'

test('QC-026 failed transfer retries the same Mux target without creating another video', async () => {
  const calls = []
  const pending = { uploadUrl: 'https://mux-upload.invalid/fixture', file: { type: 'video/mp4' }, videoId: 'video-1' }
  const fetcher = async (url, options) => { calls.push([url, options.method]); return { ok: calls.length > 1, status: 503 } }
  await assert.rejects(transferExistingUpload(pending, fetcher), /HTTP 503/)
  await transferExistingUpload(pending, fetcher)
  assert.deepEqual(calls, [['https://mux-upload.invalid/fixture', 'PUT'], ['https://mux-upload.invalid/fixture', 'PUT']])
})
