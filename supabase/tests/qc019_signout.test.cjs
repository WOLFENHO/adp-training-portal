const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')

test('QC-019 cross-origin GET cannot sign out an authenticated session', async () => {
  let calls = 0
  const source = ts.transpileModule(fs.readFileSync('src/app/auth/sign-out/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', source)((id) => id === '@/lib/supabase/server'
    ? { createClient: async () => ({ auth: { signOut: async () => { calls++; return { error: null } } } }) }
    : id === '@/lib/error-registry.mjs' ? appRequire('./src/lib/error-registry.mjs') : appRequire(id), exports)
  const response = await exports.GET(new Request('http://localhost/auth/sign-out'))
  assert.equal(response.status, 405)
  assert.equal(calls, 0)
  const forged = await exports.POST(new Request('http://localhost/auth/sign-out', { method: 'POST', headers: { origin: 'http://attacker.test' } }))
  assert.equal(forged.status, 403)
  assert.equal(calls, 0)
  const valid = await exports.POST(new Request('http://localhost/auth/sign-out', { method: 'POST', headers: { origin: 'http://localhost' } }))
  assert.equal(valid.status, 303)
  assert.equal(calls, 1)
})

test('QC-018 sign-out provider failure reports a sanitized retryable error', async () => {
  const source = ts.transpileModule(fs.readFileSync('src/app/auth/sign-out/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('require', 'exports', source)((id) => id === '@/lib/supabase/server'
    ? { createClient: async () => ({ auth: { signOut: async () => { throw Error('secret provider record') } } }) }
    : id === '@/lib/error-registry.mjs' ? appRequire('./src/lib/error-registry.mjs') : appRequire(id), exports)
  const response = await exports.POST(new Request('http://localhost/auth/sign-out', { method: 'POST', headers: { origin: 'http://localhost' } }))
  assert.equal(response.status, 503)
  const body = await response.text()
  assert.match(body, /correlationId/)
  assert.doesNotMatch(body, /secret provider record/)
})
