import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTarget, catalogQuery } from '../../scripts/qc-integration-preflight.mjs'

test('rehearsal target is exact and production is refused before opening a connection', () => {
  assert.deepEqual(validateTarget('postgresql://user:secret@db.nqqarmkgnuvvqnvnodyc.supabase.co:5432/postgres', 'nqqarmkgnuvvqnvnodyc'),
    { projectRef: 'nqqarmkgnuvvqnvnodyc', host: 'db.nqqarmkgnuvvqnvnodyc.supabase.co' })
  for (const [url, ref] of [
    ['postgresql://user:secret@db.ebwtainwlgruoglyckui.supabase.co/postgres', 'nqqarmkgnuvvqnvnodyc'],
    ['postgresql://user:secret@db.nqqarmkgnuvvqnvnodyc.supabase.co/postgres', 'ebwtainwlgruoglyckui'],
    ['postgresql://user:secret@db.nqqarmkgnuvvqnvnodyc.supabase.co.evil.invalid/postgres', 'nqqarmkgnuvvqnvnodyc']
  ]) assert.throws(() => validateTarget(url, ref), /ADP-ISO-/)
})

test('catalog captures ownership, ACL, functions, RLS policy and trigger fingerprints read-only', () => {
  for (const part of ['pg_get_functiondef', 'pg_get_userbyid', 'proacl', 'pg_policies', 'pg_get_triggerdef', 'adp_integrity_release']) assert.ok(catalogQuery.includes(part))
  assert.doesNotMatch(catalogQuery, /\b(insert|update|delete|alter|create|drop)\b/i)
})
