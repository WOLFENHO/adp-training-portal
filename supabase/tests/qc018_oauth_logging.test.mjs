import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-018 callback never logs caller-supplied OAuth error query text', () => {
  const source = fs.readFileSync('src/app/auth/callback/route.ts', 'utf8')
  assert.doesNotMatch(source, /console\.warn\([\s\S]*?providerError,\s*providerCode,/)
  assert.match(source, /correlationId/)
})
