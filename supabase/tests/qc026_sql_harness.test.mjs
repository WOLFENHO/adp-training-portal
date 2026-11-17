import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-026 disposable SQL rehearsals require isolated marker and rollback as applicable', () => {
  for (const name of ['terminal_rehearsal', 'concurrency_a', 'concurrency_b']) {
    const source = fs.readFileSync(`supabase/batch3/qc026_${name}.sql`, 'utf8')
    assert.match(source, /adp\.qc_isolated/)
    assert.match(source, /confirmed-nonproduction/)
    assert.match(source, /begin;/)
    assert.match(source, name === 'concurrency_a' ? /commit;/ : /rollback;/)
    assert.doesNotMatch(source, /delete from public\.videos|delete from public\.verified_completion_records/i)
  }
})
