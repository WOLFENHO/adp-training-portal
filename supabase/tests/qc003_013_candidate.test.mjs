import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

test('QC-003 candidate changes only the captured Release 121 heartbeat function gap block', () => {
  const baseline = fs.readFileSync('supabase/batch2/qc003_deployed_r11_capture.sql', 'utf8')
  const forward = fs.readFileSync('supabase/batch2/qc003_gap_candidate.sql', 'utf8')
  assert.equal(createHash('sha256').update(baseline).digest('hex'), 'f447709ea286384dc4e56e228a265c5e20e6e95112d0c539f7c6a8e8dec8e9ec')
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
  assert.match(sql, /revoke all on function[\s\S]*authenticated/)
  assert.doesNotMatch(sql, /grant execute/)
})
