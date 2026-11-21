const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

const actorId = '11111111-1111-4111-8111-111111111111'
const videoId = '22222222-2222-4222-8222-222222222222'
const operationId = '33333333-3333-4333-8333-333333333333'

test('QC-026 a completed upload replay verifies its exact binding and returns no upload URL', async () => {
  const routeSource = ts.transpileModule(fs.readFileSync('src/app/api/admin/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const requestHash = require('node:crypto').createHash('sha256').update(JSON.stringify(['Fixture', ''])).digest('hex')
  let providerCreates = 0
  let videoReads = 0
  let videoBinding = { id: videoId, mux_upload_id: 'upload-1', asset_id: 'asset-1',
    playback_id: 'signed-1', duration_precision_verified: true }
  let providerUpload = { id: 'upload-1', status: 'asset_created', asset_id: 'asset-1',
    new_asset_settings: { passthrough: videoId } }
  let providerAsset = { id: 'asset-1', playback_ids: [{ id: 'signed-1', policy: 'signed' }] }
  const row = { operationId, actorId, videoId, payloadHash: requestHash, status: 'asset_created',
    uploadId: 'upload-1', assetId: 'asset-1', playbackId: 'signed-1' }
  const db = {
    rpc: async name => {
      assert.equal(name, 'adp_reserve_upload_intent_qc026')
      return { data: row, error: null }
    },
    from: table => {
      assert.equal(table, 'videos')
      videoReads++
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: videoBinding, error: null }) }) }) }
    },
  }
  const mux = { video: {
    uploads: { create: async () => { providerCreates++; throw Error('duplicate upload') }, retrieve: async () => providerUpload },
    assets: { retrieve: async () => providerAsset },
  } }
  const modules = {
    '@/lib/auth': { getMember: async () => ({ id: actorId, discord_id: '123456789', is_admin: true }) },
    '@/lib/supabase/admin': { adminDb: db },
    '@/lib/supabase/server': {},
    '@/lib/api-errors.mjs': { sameOriginMutation: () => true },
    '@/lib/mux-duration-sync.mjs': {},
    '@/lib/upload-lifecycle.mjs': appRequire('./src/lib/upload-lifecycle.mjs'),
    '@/lib/upload-intent.mjs': appRequire('./src/lib/upload-intent.mjs'),
    '@/lib/upload-gate.mjs': { uploadsEnabled: () => true },
    '@/lib/admin-pages.mjs': {},
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
    '@/lib/mux': { mux },
  }
  const route = {}
  new Function('require', 'exports', routeSource)(name => modules[name] ?? appRequire(name), route)
  const previous = { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET }
  process.env.MUX_TOKEN_ID = 'fixture'
  process.env.MUX_TOKEN_SECRET = 'fixture'
  try {
    const request = () => new Request('https://preview.example/api/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'video-create', operationId, videoId, title: 'Fixture', description: '' }),
    })
    const response = await route.POST(request())
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, videoId, uploadId: 'upload-1', status: 'asset_created' })
    assert.equal(providerCreates, 0)
    assert.equal(videoReads, 1)
    videoBinding = { ...videoBinding, playback_id: 'signed-other' }
    assert.equal((await route.POST(request())).status, 503)
    videoBinding = { ...videoBinding, playback_id: 'signed-1' }
    providerUpload = { ...providerUpload, asset_id: 'asset-other' }
    assert.equal((await route.POST(request())).status, 503)
    providerUpload = { ...providerUpload, asset_id: 'asset-1' }
    providerAsset = { ...providerAsset, playback_ids: [{ id: 'unsigned', policy: 'public' }] }
    assert.equal((await route.POST(request())).status, 503)
    assert.equal(providerCreates, 0)
  } finally {
    if (previous.id === undefined) delete process.env.MUX_TOKEN_ID
    else process.env.MUX_TOKEN_ID = previous.id
    if (previous.secret === undefined) delete process.env.MUX_TOKEN_SECRET
    else process.env.MUX_TOKEN_SECRET = previous.secret
  }
})
