import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const sha = value => createHash('sha256').update(value).digest('hex')
const read = path => readFileSync(path, 'utf8')

test('bounded recovery extension preserves every previously reviewed functional statement', () => {
  const extension = read('supabase/batch3/qc026_reconcile_extension.sql')
  const bounds = "set local lock_timeout = '2s';\nset local statement_timeout = '20s';\n"
  assert.equal(extension.split(bounds).length, 2)
  assert.equal(sha(extension.replace(bounds, '')), '08981fc770919649794dfc73f24181986d883bf9eca7b358eba1e5dfeabb3f4c')
  assert.match(extension, /begin;\nset local lock_timeout = '2s';\nset local statement_timeout = '20s';/)
  assert.match(extension, /revoke all on function public\.adp_reconcile_upload_intent_qc026[\s\S]*from public,anon,authenticated,service_role;/)
  assert.match(extension, /grant execute on function public\.adp_verify_new_upload_qc026[\s\S]*to service_role;/)
})

test('extension and fixture cleanup are bounded and refuse protected/provider records', () => {
  const cleanup = read('supabase/batch3/acceptance/qc026_reconcile_cleanup.sql')
  const fixtures = read('supabase/batch3/acceptance/gold_disposable_cleanup.sql.in')
  for (const sql of [cleanup, fixtures]) {
    assert.match(sql, /set local lock_timeout\s*=\s*'2s';/)
    assert.match(sql, /set local statement_timeout\s*=\s*'20s';/)
    assert.doesNotMatch(sql, /\bdrop\b[^\n]*\bcascade\b/i)
    assert.match(sql, /commit;\s*$/)
  }
  assert.match(fixtures, /mux_upload_id is not null or asset_id is not null or playback_id is not null/)
  assert.match(fixtures, /video_id<>all\(videos\)/)
  assert.match(fixtures, /user_id<>all\(users\)/)
  assert.match(cleanup, /current_user <> 'postgres'/)
  assert.match(cleanup, /exists \(select 1 from public\.adp_upload_intents\)/)
})

test('progression installation and cleanup remain transaction-bounded', () => {
  for (const path of ['supabase/batch3/gold_training_sequence_candidate.sql',
    'supabase/batch3/acceptance/gold_training_sequence_cleanup.sql']) {
    const sql = read(path)
    assert.match(sql, /begin;\nset local lock_timeout\s*=\s*'2s';\nset local statement_timeout\s*=\s*'20s';/)
    assert.match(sql, /current_user\s*<>\s*'postgres'/)
    assert.match(sql, /commit;\s*$/)
    assert.doesNotMatch(sql, /\bdrop\s+table\b|\bcascade\b/i)
  }
})

test('Gold branch source disables automatic Preview deployment without affecting main', () => {
  const config = JSON.parse(read('vercel.json'))
  assert.deepEqual(config.git.deploymentEnabled, {
    'audit/gold-local-candidate': false,
    'recovery/gold-verified-20261121': false,
  })
  assert.equal(config.git.deploymentEnabled.main, undefined)
})
