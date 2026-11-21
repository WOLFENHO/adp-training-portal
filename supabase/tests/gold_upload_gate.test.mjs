import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadsEnabled } from '../../src/lib/upload-gate.mjs'

const rehearsal = 'https://nqqarmkgnuvvqnvnodyc.supabase.co'
test('new uploads are off by default and fail closed on project mismatch', () => {
  assert.equal(uploadsEnabled({}), false)
  assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: rehearsal }), false)
  assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true', ADP_UPLOADS_PROJECT_REF: 'ebwtainwlgruoglyckui', NEXT_PUBLIC_SUPABASE_URL: rehearsal }), false)
  assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true', ADP_UPLOADS_PROJECT_REF: 'nqqarmkgnuvvqnvnodyc', NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co.evil.invalid' }), false)
  assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true', ADP_UPLOADS_PROJECT_REF: 'nqqarmkgnuvvqnvnodyc', NEXT_PUBLIC_SUPABASE_URL: rehearsal }), true)
  assert.equal(uploadsEnabled({ ADP_UPLOADS_ENABLED: 'true', ADP_UPLOADS_PROJECT_REF: 'nqqarmkgnuvvqnvnody1', NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnody1.supabase.co' }), true)
})
