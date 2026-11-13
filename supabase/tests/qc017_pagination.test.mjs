import test from 'node:test'
import assert from 'node:assert/strict'
import { collectPages, assertDashboardSize } from '../../src/lib/admin-pages.mjs'

test('QC-017 all rows beyond the default Data API page are returned', async () => {
  const rows = Array.from({ length: 1250 }, (_, id) => ({ id }))
  const calls = []
  const result = await collectPages(async (from, to) => { calls.push([from, to]); return { data: rows.slice(from, to + 1), count: rows.length, error: null } }, 500)
  assert.equal(result.length, 1250)
  assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]])
})

test('QC-017 changing totals and query errors cannot silently truncate the dashboard', async () => {
  await assert.rejects(collectPages(async (from) => ({ data: Array.from({ length: 500 }), count: from ? 999 : 1000, error: null }), 500), /changed during pagination/)
  await assert.rejects(collectPages(async () => ({ data: [], count: null, error: { code: '08006' } }), 500), /query failed/)
})

test('QC-017 oversized dashboard is rejected before materializing thousands of rows', async () => {
  let calls = 0
  await assert.rejects(collectPages(async (from, to) => {
    calls++
    return { data: Array.from({ length: to - from + 1 }, (_, id) => ({ id: from + id })), count: 2001, error: null }
  }), /exceeds safe limit/)
  assert.ok(calls <= 4)
})

test('QC-017 cross-product progress view is bounded', () => {
  assert.doesNotThrow(() => assertDashboardSize(100, 100))
  assert.throws(() => assertDashboardSize(1000, 1000), /too large/)
})
