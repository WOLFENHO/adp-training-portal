const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

test('QC-026 verifies a new upload without invoking legacy maintenance metadata sync', async () => {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/admin/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const videoId = '22222222-2222-4222-8222-222222222222'
  let verified = 0, legacyReadiness = 0
  const db = {
    from(name) {
      assert.ok(['videos', 'adp_upload_intents'].includes(name))
      const data = name === 'videos' ? { mux_upload_id: 'upload-1', duration_precision_verified: false } :
        { operation_id: '33333333-3333-4333-8333-333333333333', video_id: videoId, mux_upload_id: 'upload-1' }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error: null }) }) }) }
    },
    rpc: async name => { assert.equal(name, 'adp_metadata_sync_integrity_version'); legacyReadiness++; return { data: 121 } },
  }
  const modules = {
    '@/lib/auth': { getMember: async () => ({ id: 'admin', is_admin: true }) },
    '@/lib/supabase/admin': { adminDb: db }, '@/lib/supabase/server': {},
    '@/lib/api-errors.mjs': { sameOriginMutation: () => true },
    '@/lib/mux-duration-sync.mjs': { verifyNewMuxUpload: async ({ videoId: id, uploadId }) => {
      assert.equal(id, videoId); assert.equal(uploadId, 'upload-1'); verified++; return { verified: true } },
      syncMuxUpload: () => { throw Error('legacy sync reached') } },
    '@/lib/upload-intent.mjs': {}, '@/lib/upload-lifecycle.mjs': {},
    '@/lib/upload-gate.mjs': { uploadsEnabled: () => false }, '@/lib/admin-pages.mjs': {},
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
    '@/lib/mux': { mux: { video: { uploads: { retrieve: () => { throw Error('unexpected provider call') } } } } },
  }
  const route = {}
  new Function('require', 'exports', source)(name => modules[name] ?? appRequire(name), route)
  const keys = ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET', 'MUX_SIGNING_KEY_ID', 'MUX_SIGNING_PRIVATE_KEY', 'MUX_METADATA_SYNC_ENABLED']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  keys.forEach(key => { process.env[key] = key === 'MUX_METADATA_SYNC_ENABLED' ? 'true' : 'fixture' })
  try {
    const response = await route.POST(new Request('https://preview.example/api/admin', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mux-sync', videoId }) }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, verified: true })
    assert.equal(verified, 1); assert.equal(legacyReadiness, 0)
  } finally {
    keys.forEach(key => previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key])
  }
})
