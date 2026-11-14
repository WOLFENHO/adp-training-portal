import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-018 admin route does not log provider or database messages and upload IDs', () => {
  const source = fs.readFileSync('src/app/api/admin/route.ts', 'utf8')
  assert.doesNotMatch(source, /message: (?:error|videoError|readinessError|auditError)\.message/)
  assert.doesNotMatch(source, /reason: error instanceof Error \? error\.message/)
  assert.doesNotMatch(source, /console\.error\([^\n]*uploadId: upload\.id/)
})

test('QC-018 Mux sync diagnostics omit provider IDs and raw errors', () => {
  const source = fs.readFileSync('src/lib/mux-duration-sync.mjs', 'utf8')
  const logs = source.match(/console\.error\([\s\S]*?\}\)/g) ?? []
  assert.ok(logs.length >= 3)
  for (const log of logs) assert.doesNotMatch(log, /uploadId|assetId|\.message|String\(error\)/)
})
