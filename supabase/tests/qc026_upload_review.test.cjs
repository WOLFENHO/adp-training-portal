const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

test('QC-026 review refuses a mismatched or expired provider target', async () => {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/admin/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  let intent = { video_id: 'video-1', actor_id: 'admin', state: 'waiting', mux_upload_id: 'bound-1',
    url_expires_at: new Date(Date.now() + 60000).toISOString() }
  let provider = { id: 'other-1', status: 'waiting', new_asset_settings: { passthrough: 'video-1' } }
  const mux = { video: { uploads: { list: async function* () { yield provider } } } }
  const db = { from: table => {
    assert.equal(table, 'adp_upload_intents')
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: intent, error: null }) }) }) }
  } }
  const modules = {
    '@/lib/auth': { getMember: async () => ({ id: 'admin', is_admin: true }) },
    '@/lib/supabase/admin': { adminDb: db },
    '@/lib/supabase/server': {},
    '@/lib/api-errors.mjs': { sameOriginMutation: () => true },
    '@/lib/mux-duration-sync.mjs': {},
    '@/lib/upload-lifecycle.mjs': {},
    '@/lib/upload-intent.mjs': appRequire('./src/lib/upload-intent.mjs'),
    '@/lib/upload-gate.mjs': { uploadsEnabled: () => true },
    '@/lib/admin-pages.mjs': {},
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
    '@/lib/mux': { mux },
  }
  const route = {}
  new Function('require', 'exports', source)(name => modules[name] ?? appRequire(name), route)
  const prior = { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET }
  process.env.MUX_TOKEN_ID = 'fixture'
  process.env.MUX_TOKEN_SECRET = 'fixture'
  try {
    const review = async () => {
      const response = await route.POST(new Request('https://preview.example/api/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload-review', operationId: '33333333-3333-4333-8333-333333333333' }),
      }))
      assert.equal(response.status, 200)
      return response.json()
    }
    assert.equal((await review()).manualReviewRequired, true)
    provider = { ...provider, id: 'bound-1' }
    assert.equal((await review()).manualReviewRequired, false)
    intent = { ...intent, url_expires_at: new Date(Date.now() - 1000).toISOString() }
    assert.equal((await review()).manualReviewRequired, true)
    provider = { ...provider, status: 'asset_created' }
    assert.equal((await review()).manualReviewRequired, true)
  } finally {
    if (prior.id === undefined) delete process.env.MUX_TOKEN_ID
    else process.env.MUX_TOKEN_ID = prior.id
    if (prior.secret === undefined) delete process.env.MUX_TOKEN_SECRET
    else process.env.MUX_TOKEN_SECRET = prior.secret
  }
})
