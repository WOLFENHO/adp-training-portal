import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAdminRows, encodeAdminCursor } from '../../src/lib/admin-keyset.mjs'

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
