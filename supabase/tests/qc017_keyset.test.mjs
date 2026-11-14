import test from 'node:test'
import assert from 'node:assert/strict'
import { pageAdminRows, encodeAdminCursor } from '../../src/lib/admin-keyset.mjs'
process.env.ADP_ADMIN_CURSOR_SECRET = 'isolated-cursor-secret-32-byte-minimum'

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

test('QC-017 progress query retains legacy completion timestamp', async () => {
  const source = await import('node:fs').then(fs => fs.readFileSync('src/lib/admin-keyset.mjs', 'utf8'))
  assert.match(source, /progress: \{[^\n]*completed_at/)
})

test('QC-017 missing dedicated secret fails before privileged read even on first page', async () => {
  const saved = process.env.ADP_ADMIN_CURSOR_SECRET
  delete process.env.ADP_ADMIN_CURSOR_SECRET
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-key-must-not-sign-cursors'
  try {
    await assert.rejects(pageAdminRows({ from() { throw Error('privileged query reached') } }, { view: 'videos' }), /cursor configuration unavailable/)
  } finally { process.env.ADP_ADMIN_CURSOR_SECRET = saved; delete process.env.SUPABASE_SERVICE_ROLE_KEY }
})

test('QC-017 key changes invalidate cursors and page-size limits reject before query', async () => {
  const first = await pageAdminRows(db, { view: 'videos', limit: 1, actorId: ids[0] })
  const saved = process.env.ADP_ADMIN_CURSOR_SECRET
  process.env.ADP_ADMIN_CURSOR_SECRET = 'different-isolated-cursor-secret-32-bytes'
  const forbidden = { from() { throw Error('privileged query reached') } }
  try {
    await assert.rejects(pageAdminRows(forbidden, { view: 'videos', cursor: first.nextCursor, actorId: ids[0] }), /invalid cursor/)
    await assert.rejects(pageAdminRows(forbidden, { view: 'videos', limit: 101 }), /invalid page/)
    await assert.rejects(pageAdminRows(forbidden, { view: 'videos', limit: 0 }), /invalid page/)
  } finally { process.env.ADP_ADMIN_CURSOR_SECRET = saved }
})

test('QC-017 standalone historical and verified completion pages have stable composite cursors', async () => {
  const video = ids[1], user = ids[0]
  const fixture = {
    historical: [{ user_id: user, video_id: video, completed_at: '2026-11-01' }],
    verified: [{ user_id: user, video_id: video, asset_id: 'assetABC_123', duration_seconds: 16.7, completed_at: '2026-11-01' }],
  }
  const database = { from(table) { const view = table === 'completion_records' ? 'historical' : table === 'verified_completion_records' ? 'verified' : null; assert.ok(view); return {
    select() { return this }, order() { return this }, or() { return this }, async limit() { return { data: fixture[view], error: null } },
  } } }
  for (const view of ['historical', 'verified']) {
    const page = await pageAdminRows(database, { view, limit: 1, actorId: user })
    assert.equal(page.rows.length, 1)
  }
})
