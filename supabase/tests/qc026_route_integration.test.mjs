import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const route = readFileSync(new URL('../../src/app/api/admin/route.ts', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('../../src/components/paged-admin-dashboard.tsx', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../batch3/qc026_upload_intents_candidate.sql', import.meta.url), 'utf8')

test('QC-026 reserves an authenticated operation before contacting Mux', () => {
  assert.match(route, /adp_reserve_upload_intent_qc026/)
  assert.ok(route.indexOf('adp_reserve_upload_intent_qc026') < route.indexOf('mux.video.uploads.create('))
  assert.match(route, /adp_claim_upload_intent_qc026/)
  assert.match(route, /adp_bind_upload_intent_qc026/)
  assert.match(route, /adp_mark_upload_review_qc026/)
})

test('QC-026 retries keep a stable operation ID across an uncertain response', () => {
  assert.match(dashboard, /operationId/)
  assert.match(dashboard, /sessionStorage/)
  assert.match(route, /input\.operationId/)
})

test('QC-026 SQL operations are transaction-bound and client table access stays revoked', () => {
  for (const name of ['reserve', 'claim', 'bind', 'mark_upload_review']) assert.match(sql, new RegExp(`adp_${name}(?:_upload_intent)?_qc026`))
  assert.match(sql, /revoke all on public\.adp_upload_intents from public,anon,authenticated/i)
})

test('QC-026 privileged upload functions have explicit service-role-only EXECUTE', () => {
  for (const name of ['adp_reserve_upload_intent_qc026','adp_claim_upload_intent_qc026','adp_bind_upload_intent_qc026','adp_mark_upload_review_qc026','adp_finalize_upload_intent_qc026']) {
    assert.match(sql, new RegExp(`revoke all on function[\\s\\S]*${name}\\([\\s\\S]*from public,anon,authenticated;`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function[\\s\\S]*${name}\\([\\s\\S]*to service_role;`, 'i'))
  }
  assert.match(sql, /revoke all on function public\.adp_upload_actor_authorized_qc026\(uuid\)/)
  assert.doesNotMatch(sql, /grant execute on function public\.adp_upload_actor_authorized_qc026\(uuid\)/)
  assert.doesNotMatch(sql, /grant execute on function[\s\S]*to authenticated;/i)
  assert.match(route, /adminDb\.rpc\('adp_bind_upload_intent_qc026'/)
})
