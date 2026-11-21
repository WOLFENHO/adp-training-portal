import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeRace, renderRaceSql } from '../batch3/acceptance/qc026_race_runner.mjs'

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  operation: '22222222-2222-4222-8222-222222222222',
  video: '33333333-3333-4333-8333-333333333333',
}

test('race renderer rejects unsafe fixture identifiers', () => {
  assert.throws(() => renderRaceSql('select {{ACTOR_UUID}};',
    { ...ids, actor: "x'); delete from videos; --" }, 4), /invalid disposable UUID/)
})

test('race runner requires distinct, overlapping backends and one winner', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qc026-race-'))
  const executable = join(dir, 'mock-psql')
  writeFileSync(executable, `#!/usr/bin/env node
let sql = ''
process.stdin.on('data', chunk => { sql += chunk })
process.stdin.on('end', () => {
  const slow = sql.includes('pg_sleep(4)')
  process.stdout.write('race_start|' + process.pid + '|' + new Date().toISOString() + '\\n')
  setTimeout(() => {
    process.stdout.write(process.pid + '|' + (slow ? 't' : 'f') + '\\n')
    process.stdout.write('race_end|' + process.pid + '|' + new Date().toISOString() + '\\n')
  }, slow ? 350 : 200)
})
`)
  chmodSync(executable, 0o700)
  try {
    for (const phase of ['reserve', 'claim']) {
      const result = await executeRace({ phase, ids, executable, environment: process.env })
      assert.equal(result.distinctPids, true)
      assert.equal(result.overlap, true)
      assert.equal(result.winners, 1)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
