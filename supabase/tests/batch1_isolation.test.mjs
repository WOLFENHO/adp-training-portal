import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSupabaseIsolation } from '../../src/lib/supabase/preview-isolation.mjs'

test('Preview refuses inherited production URL and absent expected project', () => {
  assert.throws(() => assertSupabaseIsolation({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://ebwtainwlgruoglyckui.supabase.co' }))
  assert.throws(() => assertSupabaseIsolation({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co' }))
})

test('Preview accepts only an explicitly matched isolated project', () => {
  assert.doesNotThrow(() => assertSupabaseIsolation({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://nqqarmkgnuvvqnvnodyc.supabase.co', ADP_PREVIEW_SUPABASE_REF: 'nqqarmkgnuvvqnvnodyc' }))
  assert.throws(() => assertSupabaseIsolation({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://ebwtainwlgruoglyckui.supabase.co', ADP_PREVIEW_SUPABASE_REF: 'nqqarmkgnuvvqnvnodyc' }))
})

test('Production behavior is unchanged', () => {
  assert.doesNotThrow(() => assertSupabaseIsolation({ VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://ebwtainwlgruoglyckui.supabase.co' }))
})
