const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

test('QC-026 lost response recovery checks provider twice and binds only the reserved operation', async () => {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/admin/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const now = Date.now()
  let allowed = true, duplicates = false, providerReads = 0, binds = 0, creates = 0, actor = 'admin', retrieved = null
  const intent = { actor_id: 'admin', video_id: 'video-1', state: 'needs_reconciliation', mux_upload_id: null,
    created_at: new Date(now - 300000).toISOString() }
  const target = { id: 'upload-1', status: 'waiting', url: 'https://upload.example/target', timeout: 3600,
    cors_origin: 'https://preview.example', new_asset_settings: { passthrough: 'video-1', playback_policies: ['signed'] } }
  const mux = { video: { uploads: {
    list: async function* () { yield target; if (duplicates) yield { ...target, id: 'upload-2' } },
    retrieve: async () => { providerReads++; return retrieved ?? target },
    create: async () => { creates++; throw Error('must not create') },
  } } }
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: intent, error: null }) }) }) }),
    rpc: async (name, params) => { assert.equal(name, 'adp_reconcile_upload_intent_qc026');
      assert.equal(params.p_actor_id, 'admin'); assert.equal(params.p_upload_id, target.id); binds++;
      return { data: true, error: null } },
  }
  const modules = {
    '@/lib/auth': { getMember: async () => ({ id: actor, is_admin: true }) },
    '@/lib/supabase/admin': { adminDb: db }, '@/lib/supabase/server': {},
    '@/lib/api-errors.mjs': { sameOriginMutation: () => true },
    '@/lib/mux-duration-sync.mjs': {}, '@/lib/upload-lifecycle.mjs': {},
    '@/lib/upload-gate.mjs': { uploadsEnabled: () => allowed },
    '@/lib/upload-intent.mjs': appRequire('./src/lib/upload-intent.mjs'),
    '@/lib/admin-pages.mjs': {}, '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
    '@/lib/mux': { mux },
  }
  const route = {}
  new Function('require', 'exports', source)(name => modules[name] ?? appRequire(name), route)
  const prior = { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET }
  process.env.MUX_TOKEN_ID = process.env.MUX_TOKEN_SECRET = 'fixture'
  try {
    const call = async () => route.POST(new Request('https://preview.example/api/admin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upload-reconcile', operationId: '33333333-3333-4333-8333-333333333333' }),
    }))
    allowed = false
    assert.equal((await call()).status, 503)
    assert.equal(binds, 0); assert.equal(providerReads, 0)
    allowed = true; actor = 'other'
    assert.equal((await call()).status, 403)
    actor = 'admin'; duplicates = true
    assert.equal((await call()).status, 409)
    assert.equal(providerReads, 0)
    duplicates = false
    retrieved = { ...target, new_asset_settings: { ...target.new_asset_settings, passthrough: 'other' } }
    assert.equal((await call()).status, 409)
    assert.equal(binds, 0)
    retrieved = { ...target, url: 'https://upload.example/replaced' }
    assert.equal((await call()).status, 409)
    assert.equal(binds, 0)
    retrieved = null
    const response = await call()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).uploadId, 'upload-1')
    assert.equal(providerReads, 3); assert.equal(binds, 1); assert.equal(creates, 0)
  } finally {
    for (const key of ['MUX_TOKEN_ID', 'MUX_TOKEN_SECRET']) {
      if (prior[key === 'MUX_TOKEN_ID' ? 'id' : 'secret'] === undefined) delete process.env[key]
      else process.env[key] = prior[key === 'MUX_TOKEN_ID' ? 'id' : 'secret']
    }
  }
})
