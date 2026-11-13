import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-026 isolated ledger has unique idempotency identity and no client URL access', () => {
  const sql = fs.readFileSync('supabase/batch3/qc026_upload_intents_candidate.sql', 'utf8')
  assert.match(sql, /operation_id uuid primary key/)
  assert.match(sql, /video_id uuid not null unique/)
  assert.match(sql, /mux_upload_id text unique/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /revoke all on public\.adp_upload_intents from public,anon,authenticated/)
  assert.match(sql, /on delete restrict/g)
  assert.doesNotMatch(sql, /delete from|grant.*authenticated/)
})
