import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('QC-015 audit CI is scoped to audit branches without deployment credentials or commands', () => {
  const workflow = fs.readFileSync('.github/workflows/audit-checks.yml', 'utf8')
  assert.match(workflow, /audit\/\*\*/)
  assert.match(workflow, /npm ci/)
  assert.match(workflow, /npm test/)
  assert.match(workflow, /npm run typecheck/)
  assert.match(workflow, /npm run build/)
  assert.doesNotMatch(workflow, /vercel\s+(deploy|--prod)|SUPABASE_SERVICE_ROLE_KEY:\s*\$\{|secrets\./)
})
