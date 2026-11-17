import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

test('QC-003 candidate changes only the captured Release 121 heartbeat function gap block', () => {
  const baseline = fs.readFileSync('supabase/batch2/qc003_deployed_r11_capture.sql', 'utf8')
  const forward = fs.readFileSync('supabase/batch2/qc003_gap_candidate.sql', 'utf8')
  assert.equal(createHash('sha256').update(baseline.replaceAll('\r\n', '\n')).digest('hex'), '191d662205266701233c900493bf0c6de09d9415bce07dec782a491b9172991d')
  const start = forward.indexOf('  -- QC-003 gap guard begin')
  const end = forward.indexOf('  -- QC-003 gap guard end')
  assert.ok(start > 0 && end > start)
  assert.equal(forward.slice(0, start) + forward.slice(end + '  -- QC-003 gap guard end\n'.length), baseline.replaceAll('\r\n', '\n'))
  assert.match(forward.slice(start, end), /last_heartbeat_at/)
  assert.match(forward.slice(start, end), /playback_budget_seconds=0/)
  assert.match(forward.slice(start, end), /heartbeat_gap_exceeded/)
})

test('QC-013 candidate authorizes current admin and writes audit in the same transaction', () => {
  const sql = fs.readFileSync('supabase/batch2/qc013_atomic_video_update_candidate.sql', 'utf8')
  assert.match(sql, /auth\.uid\(\)/)
  assert.match(sql, /public\.is_authorized\(\)/)
  assert.match(sql, /public\.is_administrator\(\)/)
  assert.match(sql, /for update/)
  assert.match(sql, /admin_audit_log/)
  assert.match(sql, /for key share of a,r/)
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m)
  assert.match(sql, /revoke all on function[\s\S]*authenticated/)
  assert.doesNotMatch(sql, /grant execute/)
})

test('QC-003/013 executable rehearsals require isolated marker and rollback', () => {
  for (const path of ['supabase/batch2/qc003_gap_rehearsal.sql', 'supabase/batch2/qc013_role_matrix_rehearsal.sql']) {
    const sql = fs.readFileSync(path, 'utf8')
    assert.match(sql, /adp\.qc_isolated/)
    assert.match(sql, /^begin;/m)
    assert.match(sql, /rollback;\s*$/)
  }
  const gap = fs.readFileSync('supabase/batch2/qc003_gap_rehearsal.sql', 'utf8')
  assert.match(gap, /heartbeat_gap_exceeded/)
  assert.match(gap, /watched_intervals/)
  assert.match(gap, /19\.5 seconds/)
  const role = fs.readFileSync('supabase/batch2/qc013_role_matrix_rehearsal.sql', 'utf8')
  for (const caseName of ['valid admin', 'revoked admin', 'member accepted', 'anonymous execution', 'audit failure']) assert.match(role, new RegExp(caseName))
})
