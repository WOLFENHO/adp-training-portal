// Prepared only. Run after separate approval and committed disposable fixtures.
// Credentials and tokens enter through a protected process environment; never log them.
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const ref = 'nqqarmkgnuvvqnvnodyc'
const required = name => {
  const value = process.env[name]
  if (!value) throw Error(`missing protected test setting: ${name}`)
  return value
}
const url = required('ADP_QC026_REHEARSAL_URL')
if (new URL(url).hostname !== `${ref}.supabase.co` || process.env.ADP_QC026_EXPECTED_REF !== ref) {
  throw Error('QC-026 target identity mismatch')
}
const anonKey = required('ADP_QC026_ANON_KEY')
const serviceKey = required('ADP_QC026_SERVICE_ROLE_KEY')
const actor = required('ADP_QC026_FIXTURE_ADMIN_ID')
const email = required('ADP_QC026_AUTH_EMAIL')
const password = required('ADP_QC026_AUTH_PASSWORD')
const uuid = () => randomUUID()
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
const anon = createClient(url, anonKey, options)
const authenticated = createClient(url, anonKey, options)
const privileged = createClient(url, serviceKey, options)

const noWriteCalls = [
  ['adp_reserve_upload_intent_qc026', () => ({ p_actor_id: uuid(), p_operation_id: uuid(), p_video_id: uuid(),
    p_request_hash: 'a'.repeat(64), p_title: 'QC-026 isolated', p_description: '' })],
  ['adp_claim_upload_intent_qc026', () => ({ p_actor_id: actor, p_operation_id: uuid() })],
  ['adp_bind_upload_intent_qc026', () => ({ p_actor_id: actor, p_operation_id: uuid(),
    p_upload_id: 'qc026-nonexistent', p_upload_url: 'https://disposable.invalid/upload',
    p_expires_at: new Date(Date.now() + 60000).toISOString() })],
  ['adp_mark_upload_review_qc026', () => ({ p_actor_id: actor, p_operation_id: uuid() })],
  ['adp_finalize_upload_intent_qc026', () => ({ p_actor_id: actor, p_video_id: uuid() })],
  ['adp_reconcile_upload_intent_qc026', () => ({ p_actor_id: actor, p_operation_id: uuid(),
    p_upload_id: 'qc026-nonexistent', p_upload_url: 'https://disposable.invalid/upload',
    p_expires_at: new Date(Date.now() + 60000).toISOString() })],
  ['adp_verify_new_upload_qc026', () => ({ p_actor_id: actor, p_video_id: uuid(),
    p_upload_id: 'qc026-nonexistent', p_asset_id: 'qc026-nonexistent',
    p_playback_id: 'qc026-nonexistent', p_duration: 1 })],
]

const evidence = []
const record = (role, action, result, passed) => {
  evidence.push({ role, action, status: result.status, code: result.error?.code ?? null, passed })
  if (!passed) throw Error(`QC-026 Data API permission mismatch: ${role}/${action}`)
}
function permissionDenied(result) {
  const message = result.error?.message ?? ''
  return [401, 403, 404].includes(result.status) &&
    (result.error?.code === 'PGRST202' ||
      (result.error?.code === '42501' && /permission denied/i.test(message)))
}

try {
  const signedIn = await authenticated.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.user || signedIn.data.user.id !== actor) throw Error('disposable Auth identity mismatch')

  for (const [role, client] of [['anon', anon], ['authenticated', authenticated]]) {
    const table = await client.from('adp_upload_intents').select('operation_id').limit(1)
    record(role, 'table-select', table, permissionDenied(table))
    for (const [functionName, args] of noWriteCalls) {
      const result = await client.rpc(functionName, args())
      record(role, functionName, result, permissionDenied(result))
    }
  }
  const table = await privileged.from('adp_upload_intents').select('operation_id').limit(1)
  record('service_role', 'table-select', table, table.status === 200 && !table.error)
  const unlockedAnon = await anon.rpc('adp_training_unlocked_r121', { p_video_id: uuid() })
  record('anon', 'training-unlocked', unlockedAnon, permissionDenied(unlockedAnon))
  const unlockedAuth = await authenticated.rpc('adp_training_unlocked_r121', { p_video_id: uuid() })
  record('authenticated', 'training-unlocked-missing', unlockedAuth,
    unlockedAuth.status === 200 && unlockedAuth.data === false && !unlockedAuth.error)
  for (const [functionName, args] of [
    ['start_playback_session_r12', { p_video_id: uuid() }],
    ['record_playback_heartbeat_r12', { p_session_id: uuid(), p_request_id: uuid(),
      p_expected_version: 0, p_client_sequence: 0, p_position: 0, p_is_playing: false, p_kind: 'pause' }],
  ]) {
    const result = await authenticated.rpc(functionName, args)
    record('authenticated', `legacy-denied-${functionName}`, result, permissionDenied(result))
  }
  const claim = await privileged.rpc('adp_claim_upload_intent_qc026', { p_actor_id: actor, p_operation_id: uuid() })
  record('service_role', 'claim-missing', claim, claim.status === 200 && claim.data === false)
  const helper = await privileged.rpc('adp_upload_actor_authorized_qc026', { p_actor_id: actor })
  record('service_role', 'internal-helper', helper, permissionDenied(helper))
} finally {
  await authenticated.auth.signOut().catch(() => {})
  // Only sanitized status and categorical database code leave this process.
  console.log(JSON.stringify({ target: ref, checks: evidence }))
}
