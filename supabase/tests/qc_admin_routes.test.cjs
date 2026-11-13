const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')
const ts = appRequire('typescript')

function load(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  new Function('require', 'exports', source)((id) => id in mocks ? mocks[id] : appRequire(id), exports)
  return exports
}

const id = '11111111-1111-4111-8111-111111111111'
const member = { id, discord_id: '123456789', is_admin: true }
function admin(db, mux = {}) {
  return load('src/app/api/admin/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/supabase/admin': { adminDb: db },
    '@/lib/supabase/server': {},
    '@/lib/mux-duration-sync.mjs': {},
    '@/lib/admin-pages.mjs': {},
    '@/lib/mux': { mux },
  })
}
const request = (action) => new Request('http://localhost/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })

test('QC-004 delete request never destroys provider asset or recorded training history', async () => {
  let providerDeleted = false
  let databaseDeleted = false
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { asset_id: 'test-asset' } }) }) }), delete: () => ({ eq: async () => { databaseDeleted = true; return { error: null } } }), insert: async () => ({ error: null }) }) }
  process.env.MUX_TOKEN_ID = 'fixture'; process.env.MUX_TOKEN_SECRET = 'fixture'
  const response = await admin(db, { video: { assets: { delete: async () => { providerDeleted = true } } } }).POST(request({ action: 'video-delete', videoId: id }))
  assert.equal(response.status, 409)
  assert.equal(providerDeleted, false)
  assert.equal(databaseDeleted, false)
})

test('QC-012 missing video update is not reported as success', async () => {
  const db = { from: () => ({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }), insert: async () => ({ error: null }) }) }
  const response = await admin(db).POST(request({ action: 'video-update', videoId: id, title: 'Fixture', description: '', published: false, sortOrder: 1 }))
  assert.equal(response.status, 404)
})

test('QC-008 token issuance signs for the stored duration and is never cacheable', async () => {
  let duration
  const route = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: true }) },
    '@/lib/supabase/admin': { adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { playback_id: 'test-playback', published: true, duration_seconds: 2424.367 }, error: null }) }) }) }) } },
    '@/lib/mux': { playbackToken: async (_id, d) => { duration = d; return 'fixture-token' } },
  })
  const response = await route.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })
  assert.equal(response.status, 200)
  assert.equal(duration, 2424.367)
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
})

test('QC-025 maintenance and forbidden token responses carry no-store and nosniff', async () => {
  const route = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: false, error: 'playback_maintenance' }) },
    '@/lib/supabase/admin': { adminDb: { from: () => { throw Error('unexpected read') } } },
    '@/lib/mux': { playbackToken: () => { throw Error('unexpected signing') } },
  })
  const response = await route.GET(new Request('http://localhost/api/videos/' + id + '/playback-token'), { params: Promise.resolve({ id }) })
  assert.equal(response.status, 503)
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match((await response.json()).correlationId, /^[a-f0-9-]{36}$/)
})

test('QC-025 malformed video identifier is rejected before the token database lookup', async () => {
  const route = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: true }) },
    '@/lib/supabase/admin': { adminDb: { from: () => { throw Error('unexpected database lookup') } } },
    '@/lib/mux': { playbackToken: () => { throw Error('unexpected signing') } },
  })
  const response = await route.GET(new Request('http://localhost'), { params: Promise.resolve({ id: 'bad-id' }) })
  assert.equal(response.status, 400)
})

test('QC-025 signing provider failure returns a sanitized non-cacheable response', async () => {
  const route = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: true }) },
    '@/lib/supabase/admin': { adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { playback_id: 'test', published: true, duration_seconds: 40 }, error: null }) }) }) }) } },
    '@/lib/mux': { playbackToken: async () => { throw Error('secret signing configuration') } },
  })
  const response = await route.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'playback_signing_unavailable')
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
})

test('QC-019 cross-origin or non-JSON browser mutation is rejected before a database write', async () => {
  let writes = 0
  const db = { from: () => ({ upsert: async () => { writes++; return { error: null } }, insert: async () => ({ error: null }) }) }
  const body = JSON.stringify({ action: 'access', discordId: '123456789', enabled: true })
  const cross = await admin(db).POST(new Request('http://localhost/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, body }))
  const form = await admin(db).POST(new Request('http://localhost/api/admin', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' }, body }))
  assert.equal(cross.status, 403)
  assert.equal(form.status, 403)
  assert.equal(writes, 0)
})
