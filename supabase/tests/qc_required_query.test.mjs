import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requiredQuery } from '../../src/lib/required-query.mjs'

test('QC-011 backend failure raises a bounded error instead of empty content', () => {
  assert.throws(() => requiredQuery({ data: null, error: { message: 'secret backend details' } }, 'videos'), /^Error: ADP-DATA-001:videos$/)
})

test('QC-011 legitimate empty result remains empty', () => {
  assert.deepEqual(requiredQuery({ data: [], error: null }, 'videos'), [])
})
