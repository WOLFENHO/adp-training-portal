import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-017 dashboard fetches bounded pages and exposes keyboard pagination', () => {
  const source = fs.readFileSync('src/components/paged-admin-dashboard.tsx', 'utf8')
  assert.match(fs.readFileSync('src/app/admin/page.tsx', 'utf8'), /PagedAdminDashboard/)
  assert.match(source, /\/api\/admin\/page\?/) 
  assert.doesNotMatch(source, /fetch\('\/api\/admin'\s*,\s*\{\s*cache: 'no-store'/)
  assert.match(source, /Next page/)
  assert.match(source, /Previous page/)
  assert.doesNotMatch(source, /data\.profiles\.flatMap/)
  assert.match(source, /controls\('historical'\)/)
  assert.match(source, /controls\('verified'\)/)
  assert.match(source, /No progress record/)
})
