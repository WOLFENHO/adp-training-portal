import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sql = readFileSync(new URL('../batch1/qc005_grant_candidate.sql', import.meta.url), 'utf8')
test('QC-005 grant stays behind a supplied exact target fingerprint', () => {
  assert.match(sql, /current_setting\('adp\.qc005_expected_definition_md5',true\)/)
  assert.match(sql, /expected is null or expected !~ '\^\[a-f0-9\]\{32\}\$'/)
  assert.match(sql, /md5\(definition\) <> expected/)
  assert.ok(sql.indexOf('md5(definition) <> expected') < sql.indexOf('grant execute on function'))
  assert.match(sql, /begin;[\s\S]*raise exception[\s\S]*grant execute[\s\S]*commit;/i)
})
