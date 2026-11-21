import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-026 bounded installation preserves the exact candidate apart from local timeouts', () => {
  const candidate = fs.readFileSync('supabase/batch3/qc026_upload_intents_candidate.sql', 'utf8')
  const bounded = fs.readFileSync('supabase/batch3/acceptance/qc026_install_bounded.sql', 'utf8')
  assert.equal(bounded.replace("set local lock_timeout='2s';\nset local statement_timeout='20s';\n", ''), candidate)
  assert.equal((bounded.match(/^begin;$/gm) ?? []).length, 1)
  assert.equal((bounded.match(/^commit;$/gm) ?? []).length, 1)
  assert.doesNotMatch(bounded, /^rollback;$/gm)
})

test('QC-026 race templates use two bounded transactions and only exact RPC calls', () => {
  for (const [phase, rpc] of [
    ['reserve', 'adp_reserve_upload_intent_qc026'],
    ['claim', 'adp_claim_upload_intent_qc026'],
  ]) {
    const sql = fs.readFileSync(`supabase/batch3/acceptance/qc026_race_${phase}.sql.in`, 'utf8')
    assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1)
    assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1)
    assert.match(sql, /set local role service_role;/)
    assert.match(sql, /set local lock_timeout='8s';/)
    assert.match(sql, /set local statement_timeout='20s';/)
    assert.match(sql, new RegExp(`public\\.${rpc}\\(`))
    assert.doesNotMatch(sql, /\b(?:insert|delete|drop|alter|truncate|revoke|grant)\s+(?:into|from|table|function|on)\b/i)
  }
})

test('QC-026 schema cleanup refuses nonempty ledger and never cascades', () => {
  const sql = fs.readFileSync('supabase/batch3/acceptance/qc026_cleanup_schema.sql', 'utf8')
  assert.match(sql, /exists\(select 1 from public\.adp_upload_intents\)/)
  assert.doesNotMatch(sql, /\bcascade\b/i)
  assert.equal((sql.match(/^drop function public\.adp_/gm) ?? []).length, 7)
  assert.match(sql, /^drop table public\.adp_upload_intents;$/m)
  assert.match(sql, /^commit;$/m)
})
