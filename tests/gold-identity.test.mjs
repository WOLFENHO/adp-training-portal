import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { GET } from '../app/api/gold-identity/route.js'

const keys = [
  'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF', 'ADP_GOLD_PROBE_UNTIL',
  'ADP_GOLD_PROBE_TOKEN', 'ADP_PREVIEW_SUPABASE_REF',
  'NEXT_PUBLIC_SUPABASE_URL', 'PLAYBACK_HEARTBEATS_ENABLED',
  'MUX_METADATA_SYNC_ENABLED', 'ADP_UPLOADS_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY',
]
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]))
const originalFetch = globalThis.fetch
const token = randomBytes(48).toString('hex')

before(() => {
  Object.assign(process.env, {
    VERCEL_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: 'audit/gold-local-candidate',
    ADP_GOLD_PROBE_TOKEN: token,
    ADP_PREVIEW_SUPABASE_REF: 'nqqarmkgnuvvqnvnodyc',
    NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co',
    PLAYBACK_HEARTBEATS_ENABLED: 'false',
    MUX_METADATA_SYNC_ENABLED: 'false',
    ADP_UPLOADS_ENABLED: 'false',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-placeholder',
  })
})

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

async function invoke(header = token) {
  process.env.ADP_GOLD_PROBE_UNTIL = new Date(Date.now() + 5 * 60_000).toISOString()
  return GET(new Request('https://example.invalid/api/gold-identity', {
    headers: header === null ? {} : { 'x-adp-gold-probe': header },
  }))
}

for (const [status, code] of [
  [401, 'ADP-GOLD-PROBE-HTTP-401'],
  [403, 'ADP-GOLD-PROBE-HTTP-403'],
  [404, 'ADP-GOLD-PROBE-HTTP-404'],
  [400, 'ADP-GOLD-PROBE-HTTP-4XX'],
  [429, 'ADP-GOLD-PROBE-HTTP-4XX'],
  [500, 'ADP-GOLD-PROBE-HTTP-5XX'],
  [503, 'ADP-GOLD-PROBE-HTTP-5XX'],
  [302, 'ADP-GOLD-PROBE-HTTP-UNEXPECTED'],
]) {
  test(`maps upstream ${status} to ${code} without exposing the response`, async () => {
    globalThis.fetch = async () => new Response('private upstream content', {
      status, headers: { 'x-private': 'do-not-return' },
    })
    const response = await invoke()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, code })
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  })
}

test('disabled gates prevent the Data API request', async () => {
  globalThis.fetch = async () => { throw Error('must not fetch') }
  for (const header of [null, 'incorrect']) {
    const response = await invoke(header)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { ok: false, code: 'ADP-GOLD-PROBE-DISABLED' })
  }
  await invoke()
  process.env.ADP_GOLD_PROBE_UNTIL = '2000-01-01T00:00:00.000Z'
  assert.equal((await GET(new Request('https://example.invalid', { headers: { 'x-adp-gold-probe': token } }))).status, 404)
  process.env.VERCEL_GIT_COMMIT_REF = 'main'
  assert.equal((await invoke()).status, 404)
  process.env.VERCEL_GIT_COMMIT_REF = 'audit/gold-local-candidate'
  process.env.VERCEL_ENV = 'production'
  assert.equal((await invoke()).status, 404)
  process.env.VERCEL_ENV = 'preview'
})

test('invalid configuration returns a fixed code before fetch', async () => {
  globalThis.fetch = async () => { throw Error('must not fetch') }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://other.supabase.co'
  const response = await invoke()
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, code: 'ADP-GOLD-PROBE-CONFIG' })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://nqqarmkgnuvvqnvnodyc.supabase.co'
})

test('network and JSON parsing failures keep their fixed code', async () => {
  globalThis.fetch = async () => { throw Error('private network detail') }
  assert.deepEqual(await (await invoke()).json(), { ok: false, code: 'ADP-GOLD-PROBE-NETWORK' })
  globalThis.fetch = async () => new Response('not-json', { status: 200 })
  assert.deepEqual(await (await invoke()).json(), { ok: false, code: 'ADP-GOLD-PROBE-NETWORK' })
})

test('only a single ready release 121 row passes', async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(url, /^https:\/\/nqqarmkgnuvvqnvnodyc\.supabase\.co\/rest\/v1\/adp_integrity_release\?/)
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.apikey, 'test-only-placeholder')
    return Response.json([{ version: 121, ready: true }])
  }
  assert.deepEqual(await (await invoke()).json(), { ok: true, code: 'ADP-GOLD-PROBE-OK' })
  for (const rows of [[], [{ version: 120, ready: true }], [{ version: 121, ready: false }],
    [{ version: 121, ready: true }, { version: 121, ready: true }]]) {
    globalThis.fetch = async () => Response.json(rows)
    assert.deepEqual(await (await invoke()).json(), { ok: false, code: 'ADP-GOLD-PROBE-READINESS' })
  }
})
