const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const requireApp = createRequire(process.cwd() + '/package.json')
const ts = requireApp('typescript')
const id = '11111111-1111-4111-8111-111111111111'

function load(dbError) {
  const code = ts.transpileModule(fs.readFileSync('src/app/api/videos/heartbeat/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const exports = {}
  const mocks = {
    '@/lib/auth': { getMember: async () => ({ id }) },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (name) => name === 'adp_playback_integrity_version' ? { data: 121 } : { error: dbError } }) },
    '@/lib/supabase/admin': { adminDb: { from: () => { throw Error('no privileged diagnostics read permitted') } } },
    '@/lib/api-errors.mjs': requireApp('./src/lib/api-errors.mjs'),
  }
  new Function('require', 'exports', code)((name) => name in mocks ? mocks[name] : requireApp(name), exports)
  return exports
}

test('QC-018 heartbeat failure never returns database details or logs identifiers', async () => {
  process.env.PLAYBACK_HEARTBEATS_ENABLED = 'true'
  const secret = 'postgres://secret-user:secret-password@example.invalid'
  const logs = []
  const original = console.error
  console.error = (...args) => logs.push(args)
  try {
    const response = await load({ code: 'P0001', message: `private session error ${secret}`, details: secret }).POST(new Request('http://localhost/api/videos/heartbeat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: id, requestId: id, expectedVersion: 0, clientSequence: 1, position: 0, isPlaying: false, kind: 'pause' }),
    }))
    const body = await response.json()
    assert.equal(response.status, 503)
    assert.equal(body.code, 'heartbeat_unavailable')
    assert.match(body.correlationId, /^[a-f0-9-]{36}$/)
    assert.doesNotMatch(JSON.stringify({ body, logs }), /secret-password|private session error|sessionId|userId/)
  } finally { console.error = original }
})
