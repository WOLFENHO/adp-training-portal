import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAdminRows, encodeAdminCursor } from '../../src/lib/admin-keyset.mjs'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-cursor-test-key'

const ids = Array.from({ length: 103 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const db = { from(table) { assert.equal(table, 'videos'); return {
  select(fields) { assert.equal(fields, 'id,title,description,published,sort_order,duration_seconds,duration_precision_verified,mux_upload_id,playback_id,asset_id,thumbnail_url,created_at'); return this },
  gt(key, value) { assert.equal(key, 'id'); this.cursor = value; return this },
  order(key) { assert.equal(key, 'id'); return this },
  async limit(count) { const rows = ids.filter(id => !this.cursor || id > this.cursor).slice(0, count).map(id => ({ id, title: 'Fixture' })); return { data: rows, error: null } },
} } }

test('QC-017 keyset pages are bounded, ordered and complete across multiple requests', async () => {
  let cursor = null, seen = []
  do {
    const page = await pageAdminRows(db, { view: 'videos', limit: 40, cursor })
    assert.ok(page.rows.length <= 40)
    seen.push(...page.rows.map(r => r.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(seen, ids)
})

test('QC-017 malformed or cross-view cursors fail before a privileged query', async () => {
  const forbidden = { from() { throw Error('database must not be reached') } }
  await assert.rejects(pageAdminRows(forbidden, { view: 'videos', limit: 101 }), /invalid page/)
  await assert.rejects(pageAdminRows(forbidden, { view: 'videos', limit: 10, cursor: encodeAdminCursor('profiles', [ids[0]]) }), /invalid cursor/)
})

test('QC-017 cursor tampering and cross-administrator replay fail before query', async () => {
  const first = await pageAdminRows(db, { view: 'videos', limit: 1, actorId: ids[0] })
  const forbidden = { from() { throw Error('database must not be reached') } }
  await assert.rejects(pageAdminRows(forbidden, { view: 'videos', cursor: first.nextCursor, actorId: ids[1] }), /invalid cursor/)
  const [payload, signature] = first.nextCursor.split('.')
  const raw = Buffer.from(payload, 'base64url').toString('utf8')
  const modified = `${Buffer.from(raw.replace(ids[0], ids[2])).toString('base64url')}.${signature}`
  await assert.rejects(pageAdminRows(forbidden, { view: 'videos', cursor: modified, actorId: ids[0] }), /invalid cursor/)
})

test('QC-017 empty, oversized, and concurrent insert pages remain bounded', async () => {
  const empty = { from() { return { select() { return this }, order() { return this }, async limit() { return { data: [], error: null } } } } }
  assert.deepEqual(await pageAdminRows(empty, { view: 'videos' }), { rows: [], nextCursor: null })
  const first = await pageAdminRows(db, { view: 'videos', limit: 2 })
  const added = `00000000-0000-4000-8000-000000000104`
  ids.push(added)
  try {
    const second = await pageAdminRows(db, { view: 'videos', limit: 2, cursor: first.nextCursor })
    assert.deepEqual(second.rows.map(row => row.id), ids.slice(2, 4))
  } finally { ids.pop() }
  const huge = { from() { return { select() { return this }, order() { return this }, async limit() { return { data: [{ id: ids[0], title: 'x'.repeat(70000) }], error: null } } } } }
  await assert.rejects(pageAdminRows(huge, { view: 'videos' }), /safe limit/)
})

test('QC-017 whitelist has a bounded administrator page', async () => {
  const whitelist = { from(table) { assert.equal(table, 'authorized_discord_ids'); return {
    select(fields) { assert.match(fields, /discord_id/); return this }, order(key) { assert.equal(key, 'discord_id'); return this },
    async limit() { return { data: [{ discord_id: '123456789', added_at: '2026-01-01T00:00:00Z' }], error: null } },
  } } }
  const page = await pageAdminRows(whitelist, { view: 'allowed', actorId: ids[0] })
  assert.equal(page.rows.length, 1)
})
