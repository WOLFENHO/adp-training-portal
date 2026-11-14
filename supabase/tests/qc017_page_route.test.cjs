const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

function route(member, page) {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/admin/page/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', source)((id) => ({
    '@/lib/auth': { getMember: async () => { if (member instanceof Error) throw member; return member } },
    '@/lib/supabase/admin': { adminDb: {} },
    '@/lib/admin-keyset.mjs': { pageAdminRows: page },
    '@/lib/admin-progress-page.mjs': { enrichProgressPage: async (_db, rows) => rows },
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
  })[id] ?? appRequire(id), exports)
  return exports
}

test('QC-017 page route checks authorization and parameters before privileged read', async () => {
  const forbidden = route({ is_admin: false }, () => { throw Error('query reached') })
  assert.equal((await forbidden.GET(new Request('http://localhost/api/admin/page?view=videos'))).status, 403)
  const admin = route({ is_admin: true }, async () => ({ rows: [{ id: 'fixture' }], nextCursor: null }))
  assert.equal((await admin.GET(new Request('http://localhost/api/admin/page?view=videos&limit=9999'))).status, 400)
  const response = await admin.GET(new Request('http://localhost/api/admin/page?view=videos&limit=50'))
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
})

test('QC-018 paged admin authorization outage is a redacted service error', async () => {
  const page = route(new Error('sensitive database detail'), () => { throw Error('query reached') })
  const response = await page.GET(new Request('http://localhost/api/admin/page?view=videos'))
  assert.equal(response.status, 503)
  const text = await response.text()
  assert.doesNotMatch(text, /sensitive database detail/)
  assert.match(text, /correlationId/)
})

test('QC-018 malformed pagination has its stable error category', async () => {
  const admin = route({ id: 'fixture', is_admin: true }, () => { throw Error('query reached') })
  const response = await admin.GET(new Request('http://localhost/api/admin/page?view=videos&limit=100000'))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).errorId, 'ADP-API-001')
})
