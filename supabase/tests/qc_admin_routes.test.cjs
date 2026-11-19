const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')
const ts = appRequire('typescript')

function load(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  new Function('require', 'exports', source)((id) => id in mocks ? mocks[id] : id === '@/lib/error-registry.mjs' ? appRequire('./src/lib/error-registry.mjs') : appRequire(id), exports)
  return exports
}

const id = '11111111-1111-4111-8111-111111111111'
const member = { id, discord_id: '123456789', is_admin: true }
function admin(db, mux = {}, client = {}, currentMember = member) {
  return load('src/app/api/admin/route.ts', {
    '@/lib/auth': { getMember: async () => currentMember },
    '@/lib/supabase/admin': { adminDb: db },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/mux-duration-sync.mjs': {},
    '@/lib/admin-pages.mjs': {},
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
    '@/lib/api-errors.mjs': appRequire('./src/lib/api-errors.mjs'),
    '@/lib/upload-lifecycle.mjs': appRequire('./src/lib/upload-lifecycle.mjs'),
    // Exercise the dormant implementation without opening the deployed gate.
    '@/lib/upload-gate.mjs': { uploadsEnabled: () => true },
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

test('QC-018 token maintenance and authorization use their registered error IDs', async () => {
  const route = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => member },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: false, error: 'playback_maintenance' }) },
    '@/lib/supabase/admin': {}, '@/lib/mux': {},
  })
  const response = await route.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })
  assert.equal((await response.json()).errorId, 'ADP-PRG-001')
  const authFailure = load('src/app/api/videos/[id]/playback-token/route.ts', {
    '@/lib/auth': { getMember: async () => { throw Error('secret auth failure') } },
    '@/lib/playback-gate': {}, '@/lib/supabase/admin': {}, '@/lib/mux': {},
  })
  const denied = await authFailure.GET(new Request('http://localhost'), { params: Promise.resolve({ id }) })
  assert.equal(denied.status, 503)
  assert.doesNotMatch(await denied.text(), /secret auth failure/)
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

test('QC-018 administrator validation error does not echo untrusted fields', async () => {
  const malformed = await admin({ from: () => { throw Error('unexpected write') } }).POST(request({ action: 'video-create', title: '', description: 'secret@example.test' }))
  const body = await malformed.json()
  assert.equal(malformed.status, 400)
  assert.match(body.correlationId, /^[a-f0-9-]{36}$/)
  assert.match(body.errorId, /^ADP-API-/)
  assert.doesNotMatch(JSON.stringify(body), /secret@example.test|details/)
})

test('QC-026 route reserves and claims before one provider create; duplicate retry reuses target', async () => {
  const order = [], operationId = id, videoId = '22222222-2222-4222-8222-222222222222'
  const state = { status: 'reserved', operationId, videoId, actorId: id, payloadHash: require('node:crypto').createHash('sha256').update(JSON.stringify(['Fixture', ''])).digest('hex') }
  const client = { rpc: async (name, args) => {
    order.push(name)
    if (name === 'adp_reserve_upload_intent_qc026') return { data: { ...state }, error: null }
    if (name === 'adp_claim_upload_intent_qc026') { state.status = 'creating'; return { data: true, error: null } }
    if (name === 'adp_bind_upload_intent_qc026') { state.status = 'waiting'; state.uploadId = args.p_upload_id; state.uploadUrl = args.p_upload_url; state.expiresAt = args.p_expires_at; return { data: true, error: null } }
    throw Error(`unexpected RPC: ${name}`)
  } }
  const mux = { video: { uploads: {
    create: async () => { order.push('mux.create'); return { id: 'mux-fixture', url: 'https://upload.mux.test/fixture' } },
    retrieve: async () => ({ id: 'mux-fixture', status: 'waiting', new_asset_settings: { passthrough: videoId } }),
  } } }
  process.env.MUX_TOKEN_ID = 'fixture'; process.env.MUX_TOKEN_SECRET = 'fixture'
  const route = admin(client, mux, { rpc: () => { throw Error('authenticated RPC unexpectedly invoked') } })
  const payload = { action: 'video-create', operationId, videoId, title: 'Fixture', description: '' }
  const first = await route.POST(request(payload))
  const second = await route.POST(request(payload))
  assert.equal(first.status, 200); assert.equal(second.status, 200)
  assert.equal((await second.json()).uploadId, 'mux-fixture')
  assert.deepEqual(order, ['adp_reserve_upload_intent_qc026', 'adp_claim_upload_intent_qc026', 'mux.create', 'adp_bind_upload_intent_qc026', 'adp_reserve_upload_intent_qc026'])
})

test('QC-026 mismatched provider identity is quarantined before database binding', async () => {
  const operationId = id, videoId = '22222222-2222-4222-8222-222222222222'
  let bound = 0, reviewed = 0
  const database = { rpc: async name => {
    if (name === 'adp_reserve_upload_intent_qc026') return { data: { operationId, videoId, actorId: id, payloadHash: require('node:crypto').createHash('sha256').update(JSON.stringify(['Fixture', ''])).digest('hex'), status: 'reserved' }, error: null }
    if (name === 'adp_claim_upload_intent_qc026') return { data: true, error: null }
    if (name === 'adp_bind_upload_intent_qc026') { bound++; return { data: true, error: null } }
    if (name === 'adp_mark_upload_review_qc026') { reviewed++; return { data: true, error: null } }
    throw Error('unexpected RPC')
  } }
  const mux = { video: { uploads: {
    create: async () => ({ id: 'upload-1', url: 'https://provider.invalid/target' }),
    retrieve: async () => ({ id: 'upload-1', url: 'https://provider.invalid/target', status: 'waiting', new_asset_settings: { passthrough: 'wrong-video' } }),
  } } }
  process.env.MUX_TOKEN_ID = 'fixture'; process.env.MUX_TOKEN_SECRET = 'fixture'
  const response = await admin(database, mux, database).POST(request({ action: 'video-create', operationId, videoId, title: 'Fixture', description: '' }))
  assert.equal(response.status, 503)
  assert.equal(bound, 0)
  assert.equal(reviewed, 1)
})

test('QC-026 reserve failure and lost Mux response never start a second provider create', async () => {
  const operationId = id, videoId = '22222222-2222-4222-8222-222222222222', payload = { action: 'video-create', operationId, videoId, title: 'Fixture', description: '' }
  let creates = 0, status = 'reserved', review = 0
  const mux = { video: { uploads: { create: async () => { creates++; throw Error('ambiguous secret provider response') } } } }
  const failedReserve = admin({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'secret DB detail' } }) }, mux)
  const blocked = await failedReserve.POST(request(payload))
  assert.equal(blocked.status, 503); assert.equal(creates, 0)
  assert.doesNotMatch(await blocked.text(), /secret DB detail/)
  const client = { rpc: async (name) => {
    if (name === 'adp_reserve_upload_intent_qc026') return { data: { operationId, videoId, actorId: id, payloadHash: require('node:crypto').createHash('sha256').update(JSON.stringify(['Fixture', ''])).digest('hex'), status }, error: null }
    if (name === 'adp_claim_upload_intent_qc026') { status = 'creating'; return { data: true, error: null } }
    if (name === 'adp_mark_upload_review_qc026') { status = 'needs_reconciliation'; review++; return { data: true, error: null } }
    throw Error('unexpected RPC')
  } }
  const route = admin(client, mux, { rpc: () => { throw Error('authenticated RPC unexpectedly invoked') } })
  const first = await route.POST(request(payload)), retry = await route.POST(request(payload))
  assert.equal(first.status, 503); assert.equal(retry.status, 503)
  assert.equal(creates, 1); assert.equal(review, 1)
  assert.doesNotMatch(await retry.text(), /secret provider/)
})

test('QC-005 progress RPC denial is sanitized while its authenticated context is preserved', async () => {
  const client = { rpc: async (name) => {
    assert.equal(name, 'adp_admin_progress')
    return { data: null, error: { code: '42501', message: 'internal privileged function details' } }
  } }
  const response = await admin({}, {}, client).POST(request({ action: 'progress-complete', userId: id, videoId: id }))
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.match(body, /ADP-ADM-020/)
  assert.doesNotMatch(body, /internal privileged function details/)
})

test('QC-026 read-only review counts all provider pages without exposing upload URLs', async () => {
  const db = { from: name => {
    assert.equal(name, 'adp_upload_intents')
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { video_id: id, state: 'needs_reconciliation', mux_upload_id: null }, error: null }) }) }) }
  } }
  const mux = { video: { uploads: { list: async function* () {
    yield { id: 'unrelated', new_asset_settings: { passthrough: 'other' }, url: 'secret-url' }
    yield { id: 'candidate', new_asset_settings: { passthrough: id }, url: 'secret-url' }
  } } } }
  const response = await admin(db, mux).POST(request({ action: 'upload-review', operationId: id }))
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.match(body, /"providerMatches":1/)
  assert.match(body, /"manualReviewRequired":true/)
  assert.doesNotMatch(body, /secret-url|candidate|unrelated/)
})


test('QC-026 unauthorized caller cannot reserve or obtain a signed upload URL', async () => {
  let calls = 0
  const db = { rpc: async () => { calls++; throw Error('privileged invocation') } }
  const mux = { video: { uploads: { create: async () => { calls++; throw Error('provider invocation') } } } }
  const response = await admin(db, mux, {}, null).POST(request({ action: 'video-create', operationId: id, videoId: id, title: 'Fixture', description: '' }))
  assert.ok([401, 403].includes(response.status))
  assert.equal(calls, 0)
  assert.doesNotMatch(await response.text(), /uploadUrl|provider invocation|privileged invocation/)
})

