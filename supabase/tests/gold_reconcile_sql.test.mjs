import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('QC-026 recovery SQL has narrow permissions, immutable identity, and row locks', () => {
  const sql = readFileSync('supabase/batch3/qc026_reconcile_extension.sql', 'utf8')
  assert.match(sql, /adp_upload_actor_authorized_qc026\(p_actor_id\)/)
  assert.match(sql, /where operation_id=p_operation_id for update/)
  assert.match(sql, /r\.actor_id<>p_actor_id/)
  assert.match(sql, /r\.mux_upload_id is not null/)
  assert.match(sql, /v\.published or v\.mux_upload_id is not null or v\.asset_id is not null/)
  assert.match(sql, /revoke all on function public\.adp_reconcile_upload_intent_qc026[\s\S]*from public,anon,authenticated,service_role/)
  assert.match(sql, /grant execute on function public\.adp_reconcile_upload_intent_qc026[\s\S]*to service_role/)
  assert.match(sql, /end \$\$;[\s\S]*commit;/)
})
