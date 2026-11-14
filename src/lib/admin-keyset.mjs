import { createHmac, timingSafeEqual } from 'node:crypto'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const views = {
  allowed: { table: 'authorized_discord_ids', fields: 'discord_id,added_at', keys: ['discord_id'], validate: value => /^\d{5,25}$/.test(value) },
  videos: { table: 'videos', fields: 'id,title,description,published,sort_order,duration_seconds,duration_precision_verified,mux_upload_id,playback_id,asset_id,thumbnail_url,created_at', keys: ['id'] },
  profiles: { table: 'profiles', fields: 'id,discord_id,username,avatar_url,last_seen_at', keys: ['id'] },
  progress: { table: 'user_video_progress', fields: 'user_id,video_id,watched_seconds,verified_watched_seconds,completed_at,updated_at', keys: ['user_id', 'video_id'] },
  historical: { table: 'completion_records', fields: 'user_id,video_id,completed_at,method', keys: ['user_id', 'video_id'] },
  verified: { table: 'verified_completion_records', fields: 'user_id,video_id,asset_id,duration_seconds,completed_at,verified_at,validator_version,asset_identity,reset_at', keys: ['user_id', 'video_id', 'asset_id', 'duration_seconds'] },
}

function cursorKey() {
  const key = process.env.ADP_ADMIN_CURSOR_SECRET
  if (!key || Buffer.byteLength(key, 'utf8') < 32) throw new Error('dashboard cursor configuration unavailable')
  return key
}
export function encodeAdminCursor(view, values, actorId = '') {
  const payload = Buffer.from(JSON.stringify({ v: 1, view, values, actorId }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', cursorKey()).update('adp-admin-cursor-v1:').update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function decodeCursor(cursor, view, keys, actorId) {
  if (!cursor) return null
  try {
    if (typeof cursor !== 'string' || cursor.length > 400) throw Error()
    const [payload, signature, extra] = cursor.split('.')
    if (!payload || !signature || extra) throw Error()
    const expected = createHmac('sha256', cursorKey()).update('adp-admin-cursor-v1:').update(payload).digest()
    const supplied = Buffer.from(signature, 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw Error()
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const valid = (value, index) => {
      if (view === 'allowed') return /^\d{5,25}$/.test(value)
      if (view === 'verified' && index === 2) return /^[A-Za-z0-9_-]{1,128}$/.test(value)
      if (view === 'verified' && index === 3) return /^\d{1,9}(?:\.\d{1,3})?$/.test(value) && Number(value) > 0
      return uuid.test(value)
    }
    if (parsed.v !== 1 || parsed.view !== view || parsed.actorId !== actorId || !Array.isArray(parsed.values) || parsed.values.length !== keys.length || !parsed.values.every((value, index) => typeof value === 'string' && valid(value, index))) throw Error()
    return parsed.values
  } catch { throw new Error('invalid cursor') }
}

/** Authorized caller supplies db; this function never accepts arbitrary tables or fields. */
export async function pageAdminRows(db, { view, limit = 50, cursor = null, maxBytes = 65536, actorId = '' }) {
  const spec = views[view]
  if (!spec || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid page')
  cursorKey() // Fail closed before any privileged read, including the first page.
  const values = decodeCursor(cursor, view, spec.keys, actorId)
  let query = db.from(spec.table).select(spec.fields)
  if (values && spec.keys.length === 1) query = query.gt(spec.keys[0], values[0])
  if (values && spec.keys.length > 1) query = query.or(spec.keys.map((key, index) => index === 0 ? `${key}.gt.${values[index]}` : `and(${spec.keys.slice(0, index).map((prefix, n) => `${prefix}.eq.${values[n]}`).join(',')},${key}.gt.${values[index]})`).join(','))
  for (const key of spec.keys) query = query.order(key)
  const result = await query.limit(limit + 1)
  if (result.error || !Array.isArray(result.data)) throw new Error('dashboard page unavailable')
  const rows = result.data.slice(0, limit)
  while (rows.length > 1 && Buffer.byteLength(JSON.stringify(rows), 'utf8') > maxBytes) rows.pop()
  if (Buffer.byteLength(JSON.stringify(rows), 'utf8') > maxBytes) throw new Error('dashboard row exceeds safe limit')
  const hasMore = result.data.length > rows.length
  const last = rows.at(-1)
  return { rows, nextCursor: hasMore && last ? encodeAdminCursor(view, spec.keys.map(key => String(last[key])), actorId) : null }
}
