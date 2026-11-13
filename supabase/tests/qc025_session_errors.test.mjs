import test from 'node:test'
import assert from 'node:assert/strict'
import { safeSessionRpcError, sameOriginMutation } from '../../src/lib/api-errors.mjs'
import fs from 'node:fs'
import ts from 'typescript'
import { createRequire } from 'node:module'
const appRequire = createRequire(import.meta.url)

test('QC-025 unexpected database messages are sanitized and mapped to a stable error ID', () => {
  const result = safeSessionRpcError({ code: '23505', message: 'conflict: private user@example.test token=secret' })
  assert.deepEqual(result, { status: 503, code: 'session_unavailable', errorId: 'ADP-PRG-004' })
  assert.doesNotMatch(JSON.stringify(result), /private|token|secret/)
})

test('QC-019 same-origin session mutation rejects forged Origin and Fetch Metadata', () => {
  assert.equal(sameOriginMutation(new Request('https://portal.test/api/videos/id/session', { method: 'POST', headers: { origin: 'https://evil.test' } })), false)
  assert.equal(sameOriginMutation(new Request('https://portal.test/api/videos/id/session', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })), false)
  assert.equal(sameOriginMutation(new Request('https://portal.test/api/videos/id/session', { method: 'POST', headers: { origin: 'https://portal.test' } })), true)
})

test('QC-025 session route redacts database failure from response and diagnostic log', { concurrency: false }, async () => {
  const source = ts.transpileModule(fs.readFileSync('src/app/api/videos/[id]/session/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  const canary = 'secret-user@example.test'
  new Function('require', 'exports', source)((id) => ({
    '@/lib/auth': { getMember: async () => ({ id: 'fixture' }) },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async (name) => name === 'adp_playback_integrity_version' ? { data: 121, error: null } : { data: null, error: { code: 'XX000', message: canary } } }) },
    '@/lib/api-errors.mjs': { safeSessionRpcError, sameOriginMutation },
  })[id] ?? appRequire(id), exports)
  const previous = process.env.PLAYBACK_HEARTBEATS_ENABLED
  const log = console.error
  const entries = []
  process.env.PLAYBACK_HEARTBEATS_ENABLED = 'true'
  console.error = (...args) => { entries.push(args) }
  try {
    const response = await exports.POST(new Request('http://localhost/api/videos/11111111-1111-4111-8111-111111111111/session', { method: 'POST' }), { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) })
    assert.equal(response.status, 503)
    assert.equal((await response.json()).errorId, 'ADP-PRG-004')
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
    assert.doesNotMatch(JSON.stringify(entries), /secret-user/)
  } finally {
    console.error = log
    if (previous === undefined) delete process.env.PLAYBACK_HEARTBEATS_ENABLED
    else process.env.PLAYBACK_HEARTBEATS_ENABLED = previous
  }
})
