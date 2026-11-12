import test from 'node:test'
import assert from 'node:assert/strict'
import { checkProbeAccess, probeIdentity } from '../../src/lib/supabase/qc014-probe.mjs'

const base = { VERCEL_ENV: 'preview', ADP_QC_PROBE_ENABLED: 'true', ADP_QC_PROBE_UNTIL: new Date(Date.now() + 10 * 60_000).toISOString(), ADP_QC_PROBE_TOKEN: 'disposable-probe-test-token-123456789', ADP_PREVIEW_SUPABASE_REF: 'nqqarmkgnuvvqnvnodyc', NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co', NEXT_PUBLIC_APP_URL: 'https://adp-training-portal-git-audit-qc-batch1-isolated-uther.vercel.app', SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key', MUX_TOKEN_ID: 'DISABLED_QC014', MUX_SIGNING_KEY_ID: 'DISABLED_QC014', PLAYBACK_HEARTBEATS_ENABLED: 'false', MUX_METADATA_SYNC_ENABLED: 'false' }

test('unauthorized or expired probe never reaches the database', async () => {
  let calls = 0
  for (const [env, header] of [[base, ''], [base, 'wrong'], [{ ...base, ADP_QC_PROBE_UNTIL: '2000-01-01T00:00:00Z' }, base.ADP_QC_PROBE_TOKEN], [{ ...base, VERCEL_ENV: 'production' }, base.ADP_QC_PROBE_TOKEN]]) {
    const result = await probeIdentity(env, header, async () => { calls++; return { version: 121, ready: true } })
    assert.equal(result.ok, false)
  }
  assert.equal(calls, 0)
})

test('missing or mismatched config fails before privileged query', async () => {
  let calls = 0
  for (const env of [
    { ...base, SUPABASE_SERVICE_ROLE_KEY: '' },
    { ...base, SUPABASE_SERVICE_ROLE_KEY: 'DISABLED_PENDING_REHEARSAL_CREDENTIAL' },
    { ...base, ADP_PREVIEW_SUPABASE_REF: 'ebwtainwlgruoglyckui' },
    { ...base, NEXT_PUBLIC_SUPABASE_URL: 'https://ebwtainwlgruoglyckui.supabase.co' },
    { ...base, MUX_TOKEN_ID: 'inherited-id' },
    { ...base, MUX_TOKEN_SECRET: 'inherited-secret' },
    { ...base, MUX_SIGNING_PRIVATE_KEY: 'inherited-signing-key' },
    { ...base, NEXT_PUBLIC_APP_URL: 'https://analytics-s45.vercel.app' },
  ]) {
    const result = await probeIdentity(env, base.ADP_QC_PROBE_TOKEN, async () => { calls++; return { version: 121, ready: true } })
    assert.equal(result.ok, false)
  }
  assert.equal(calls, 0)
})

test('accepted service credential is proved by a read-only Release 121 query', async () => {
  let calls = 0
  const result = await probeIdentity(base, base.ADP_QC_PROBE_TOKEN, async url => {
    calls++
    assert.equal(url, 'https://nqqarmkgnuvvqnvnodyc.supabase.co')
    return { version: 121, ready: true }
  })
  assert.equal(calls, 1)
  assert.deepEqual(result, { expectedProjectRef: 'nqqarmkgnuvvqnvnodyc', ok: true, code: 'ADP-QC014-OK' })
  assert.equal((await probeIdentity(base, base.ADP_QC_PROBE_TOKEN, async () => { throw Error('private credential') })).code, 'ADP-QC014-KEY-REJECTED')
  assert.equal(checkProbeAccess(base, base.ADP_QC_PROBE_TOKEN).ok, true)
})
