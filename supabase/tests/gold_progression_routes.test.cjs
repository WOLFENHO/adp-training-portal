const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createRequire } = require('node:module')
const appRequire = createRequire(process.cwd() + '/package.json')
const id = '11111111-1111-4111-8111-111111111111'
function load(file, mocks) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const output = {}
  new Function('require', 'exports', source)((name) => mocks[name] ?? appRequire(name), output)
  return output
}

test('locked module issues no playback token or session, even with playback enabled', async () => {
  let signed = 0, started = 0
  const common = {
    '@/lib/auth': { getMember: async () => ({ id, is_admin: false }) },
    '@/lib/training-access': { trainingUnlocked: async () => false },
    '@/lib/playback-gate': { getPlaybackGate: async () => ({ enabled: true }) },
    '@/lib/supabase/admin': { adminDb: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { published: true, playback_id: 'playback', duration_seconds: 20 } }) }) }) }) } },
    '@/lib/supabase/server': { createClient: async () => ({ rpc: async name => {
      if (name === 'adp_playback_integrity_version') return { data: 121 }
      started++; return { data: { sessionId: id } }
    } }) },
    '@/lib/mux': { playbackToken: () => { signed++; return 'signed' } },
    '@/lib/api-errors.mjs': appRequire('./src/lib/api-errors.mjs'),
    '@/lib/error-registry.mjs': appRequire('./src/lib/error-registry.mjs'),
  }
  const token = load('src/app/api/videos/[id]/playback-token/route.ts', common)
  const session = load('src/app/api/videos/[id]/session/route.ts', common)
  const previous = process.env.PLAYBACK_HEARTBEATS_ENABLED
  process.env.PLAYBACK_HEARTBEATS_ENABLED = 'true'
  try {
    const tokenResponse = await token.GET(new Request(`https://preview.example/api/videos/${id}/playback-token`), { params: Promise.resolve({ id }) })
    assert.equal(tokenResponse.status, 403)
    assert.equal((await tokenResponse.json()).error, 'training_locked')
    const sessionResponse = await session.POST(new Request(`https://preview.example/api/videos/${id}/session`, { method: 'POST' }), { params: Promise.resolve({ id }) })
    assert.equal(sessionResponse.status, 403)
    assert.equal((await sessionResponse.json()).error, 'training_locked')
    assert.equal(signed, 0); assert.equal(started, 0)
  } finally { if (previous === undefined) delete process.env.PLAYBACK_HEARTBEATS_ENABLED; else process.env.PLAYBACK_HEARTBEATS_ENABLED = previous }
})
