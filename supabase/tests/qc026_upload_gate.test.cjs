const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const requireModule = createRequire(__filename)

function loadAdminRoute(calls) {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/admin/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const forbidden = new Proxy({}, { get(_target, key) { calls.push(String(key)); throw Error('privileged operation reached') } })
  const modules = {
    '@/lib/auth': { getMember: async () => ({ id: '11111111-1111-4111-8111-111111111111', is_admin: true }) },
    '@/lib/supabase/admin': { adminDb: forbidden },
    '@/lib/supabase/server': { createClient: () => { throw Error('privileged client reached') } },
    '@/lib/api-errors.mjs': { sameOriginMutation: () => true },
    '@/lib/mux-duration-sync.mjs': { syncMuxUpload: () => { throw Error('Mux reached') } },
    '@/lib/upload-lifecycle.mjs': { createOrResumeUpload: () => { throw Error('upload lifecycle reached') } },
    '@/lib/upload-intent.mjs': { planRecoveredUpload: () => { throw Error('upload recovery reached') } },
    '@/lib/upload-gate.mjs': requireModule('../../src/lib/upload-gate.mjs'),
    '@/lib/admin-pages.mjs': { collectPages: () => { throw Error('admin paging reached') } },
    '@/lib/error-registry.mjs': {
      identifyError: code => ({ status: code === 'uploads_disabled' ? 503 : 500, errorId: 'ADP-ADM-021' }),
      sanitizeApiError: (code, correlationId) => ({ error: code, correlationId }),
    },
  }
  const exports = {}
  new Function('require', 'exports', source)(id => modules[id] ?? requireModule(id), exports)
  return exports
}

for (const environment of ['production', 'preview']) {
  test(`QC-026 ${environment} direct POST cannot start or review uploads while disabled`, async () => {
    const previous = { VERCEL_ENV: process.env.VERCEL_ENV, ADP_UPLOADS_ENABLED: process.env.ADP_UPLOADS_ENABLED }
    process.env.VERCEL_ENV = environment
    process.env.ADP_UPLOADS_ENABLED = 'true' // even a misconfigured Preview cannot bypass this release gate
    try {
      const calls = []
      const admin = loadAdminRoute(calls)
      for (const payload of [
        { action: 'video-create', operationId: '11111111-1111-4111-8111-111111111111', videoId: '22222222-2222-4222-8222-222222222222', title: 'Test', description: '' },
        { action: 'upload-review', operationId: '11111111-1111-4111-8111-111111111111' },
      ]) {
        const response = await admin.POST(new Request('https://preview.example/api/admin', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        }))
        assert.equal(response.status, 503)
        assert.equal((await response.json()).error, 'uploads_disabled')
      }
      assert.deepEqual(calls, [])
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
}
