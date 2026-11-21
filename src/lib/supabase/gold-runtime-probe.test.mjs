import test from 'node:test'
import assert from 'node:assert/strict'
import { checkGoldRuntime } from './gold-runtime-probe.mjs'

const now = Date.parse('2026-11-21T16:00:00Z')
const token = 't'.repeat(64)
const env = () => ({
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'recovery/gold-verified-20261121',
  ADP_GOLD_RUNTIME_UNTIL: new Date(now + 5 * 60_000).toISOString(),
  ADP_GOLD_RUNTIME_TOKEN: token, ADP_PREVIEW_SUPABASE_REF: 'nqqarmkgnuvvqnvnodyc',
  NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co',
  ADP_UPLOADS_ENABLED: 'false', PLAYBACK_HEARTBEATS_ENABLED: 'false',
  MUX_METADATA_SYNC_ENABLED: 'false', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
})

test('branch, expiry and operator token disable the endpoint before any request', async () => {
  const forbidden = () => { throw Error('fetch must not run') }
  for (const change of [
    { VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'audit/gold-local-candidate' },
    { ADP_GOLD_RUNTIME_UNTIL: new Date(now - 1).toISOString() },
    { ADP_GOLD_RUNTIME_UNTIL: new Date(now + 16 * 60_000).toISOString() },
  ]) assert.deepEqual(await checkGoldRuntime({ ...env(), ...change }, token, forbidden, now),
    { ok: false, code: 'ADP-GOLD-RUNTIME-DISABLED' })
  assert.deepEqual(await checkGoldRuntime(env(), 'wrong', forbidden, now),
    { ok: false, code: 'ADP-GOLD-RUNTIME-DISABLED' })
})

test('configuration mismatch stops before fetch', async () => {
  const result = await checkGoldRuntime({ ...env(), NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' },
    token, () => { throw Error('fetch must not run') }, now)
  assert.deepEqual(result, { ok: false, code: 'ADP-GOLD-RUNTIME-CONFIG' })
})

for (const [status, category] of [[401, '401'], [403, '403'], [404, '404'],
  [429, '4XX'], [503, '5XX'], [302, 'UNEXPECTED']]) {
  test(`HTTP ${status} returns fixed category ${category}`, async () => {
    const result = await checkGoldRuntime(env(), token, async (url, options) => {
      assert.equal(new URL(url).hostname, 'nqqarmkgnuvvqnvnodyc.supabase.co')
      assert.equal(options.headers.apikey, 'fixture-service-key')
      assert.equal(options.headers.Authorization, 'Bearer fixture-service-key')
      return { ok: false, status, json: async () => { throw Error('must not read body') } }
    }, now)
    assert.deepEqual(result, { ok: false, code: `ADP-GOLD-RUNTIME-HTTP-${category}` })
  })
}

test('network, readiness and successful identity produce fixed codes only', async () => {
  const network = await checkGoldRuntime(env(), token, async () => { throw Error('sensitive response') }, now)
  assert.deepEqual(network, { ok: false, code: 'ADP-GOLD-RUNTIME-NETWORK' })
  const read = data => async () => ({ ok: true, json: async () => data })
  assert.deepEqual(await checkGoldRuntime(env(), token, read([{ version: 12, ready: true }]), now),
    { ok: false, code: 'ADP-GOLD-RUNTIME-READINESS' })
  assert.deepEqual(await checkGoldRuntime(env(), token, read([{ version: 121, ready: true }]), now),
    { ok: true, code: 'ADP-GOLD-RUNTIME-READY' })
})
