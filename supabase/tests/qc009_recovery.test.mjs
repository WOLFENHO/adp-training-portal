import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithDeadline, createReceiptRetry, createReceiptBarrier } from '../../src/lib/playback-recovery.mjs'

test('QC-009 a hung heartbeat is aborted after a bounded deadline', async () => {
  let aborted = false
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true
    reject(new Error('aborted'))
  }, { once: true }))
  await assert.rejects(fetchWithDeadline(fetcher, '/api/videos/heartbeat', { method: 'POST' }, 10))
  assert.equal(aborted, true)
})

test('QC-009 deadline includes reading the response body', async () => {
  const fetcher = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('body timed out')), { once: true }))
  await assert.rejects(fetchWithDeadline(fetcher, '/api/videos/heartbeat', {}, 10), /body timed out/)
})

test('QC-009 lost complete response retries identical request until receipt is known', async () => {
  const receipt = { requestId: 'fixed-id', expectedVersion: 7, clientSequence: 8, kind: 'complete', position: 16.6517 }
  const observed = []
  let retry
  const controller = createReceiptRetry({
    attempt: async (item) => { observed.push(structuredClone(item)); return observed.length === 1 ? 'network-error' : 'accepted' },
    schedule: (fn) => { retry = fn; return 1 },
    cancel: () => {},
  })
  controller.remember(receipt)
  await controller.retryNow()
  assert.equal(controller.hasPending(), true)
  await retry()
  assert.equal(controller.hasPending(), false)
  assert.deepEqual(observed, [receipt, receipt])
})

test('QC-009 retries stop after disposal or permanent rejection', async () => {
  let calls = 0
  const rejected = createReceiptRetry({ attempt: async () => { calls++; return 'rejected' }, schedule: () => 1, cancel: () => {} })
  rejected.remember({ requestId: 'fixed' })
  await rejected.retryNow()
  assert.equal(rejected.hasPending(), false)
  const closed = createReceiptRetry({ attempt: async () => { calls++ }, schedule: () => 1, cancel: () => {} })
  closed.remember({ requestId: 'fixed' })
  closed.dispose()
  await closed.retryNow()
  assert.equal(calls, 1)
})

test('QC-009 later pause and completion wait through repeated lost receipts', async () => {
  const seen = []
  const media = { paused: false, pause() { this.paused = true } }
  const receipt = Object.freeze({ requestId: 'play-1', expectedVersion: 0, clientSequence: 1, kind: 'play' })
  const barrier = createReceiptBarrier()
  barrier.hold(receipt)
  media.pause()
  const later = barrier.wait().then(() => { seen.push('pause-2', 'complete-3') })
  let retryCount = 0
  const retry = createReceiptRetry({
    attempt: async (item) => { seen.push(item); return ++retryCount < 3 ? 'network-error' : 'accepted' },
    schedule: () => 1,
    cancel: () => {},
  })
  retry.remember(receipt)
  await retry.retryNow()
  await retry.retryNow()
  assert.equal(media.paused, true)
  assert.deepEqual(seen, [receipt, receipt])
  await retry.retryNow()
  barrier.settle(receipt)
  await later
  assert.deepEqual(seen, [receipt, receipt, receipt, 'pause-2', 'complete-3'])
})

test('QC-009 unmount releases waiting operations and discards retry', async () => {
  const barrier = createReceiptBarrier()
  barrier.hold({ requestId: 'complete' })
  const wait = barrier.wait()
  barrier.dispose()
  assert.equal(await wait, false)
})
