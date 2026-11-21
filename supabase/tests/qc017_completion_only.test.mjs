import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichCompletionPage } from '../../src/lib/admin-completion-page.mjs'
import fs from 'node:fs'

const user = '00000000-0000-4000-8000-000000000001'
const video = '00000000-0000-4000-8000-000000000002'
const historical = { user_id: user, video_id: video, method: 'admin_override', completed_at: '2026-11-01T00:00:00Z' }
const verified = { user_id: user, video_id: video, asset_id: 'assetA', duration_seconds: 16.7, validator_version: 12, asset_identity: 'assetA:16.700:12', reset_at: null, verified_at: '2026-11-02T00:00:00Z' }
function db(progress = []) { const rows = { profiles: [{ id: user, username: 'Member' }], videos: [{ id: video, title: 'Test', asset_id: 'assetA', duration_seconds: 16.7, duration_precision_verified: true }], user_video_progress: progress }; return { from(table) { return { select() { return this }, in() { return this }, async limit() { return { data: rows[table], error: null } } } } } }

test('QC-017 completion-only records are visible without a progress row', async () => {
  const historicalPage = await enrichCompletionPage(db(), [historical], 'historical')
  const verifiedPage = await enrichCompletionPage(db(), [verified], 'verified')
  assert.equal(historicalPage[0].hasProgress, false)
  assert.equal(historicalPage[0].status, 'Historical completion')
  assert.equal(verifiedPage[0].hasProgress, false)
  assert.equal(verifiedPage[0].status, 'Current verified completion')
  const unbound = await enrichCompletionPage(db(), [{ ...verified, verified_at: null }], 'verified')
  assert.equal(unbound[0].status, 'Previous verified evidence')
})

test('QC-017 stale asset completion stays visible as historical evidence', async () => {
  const page = await enrichCompletionPage(db(), [{ ...verified, asset_identity: 'stale:16.700:12' }], 'verified')
  assert.equal(page[0].status, 'Previous verified evidence')
})

test('QC-017 Release 121 schema permits completion without progress', () => {
  const init = fs.readFileSync('supabase/migrations/202610290001_init.sql', 'utf8')
  const release = fs.readFileSync('supabase/migrations/202610300007_release_1_2_progress_provenance.sql', 'utf8')
  const r121 = fs.readFileSync('supabase/migrations/202610300008_release_1_2_1_integrity.sql', 'utf8')
  const historicalTable = init.split('create table public.completion_records (')[1].split(');')[0]
  const verifiedTable = release.split('create table if not exists public.verified_completion_records (')[1].split(');')[0]
  assert.doesNotMatch(historicalTable + verifiedTable, /references public\.user_video_progress/)
  assert.match(r121, /p_action='progress-complete'[\s\S]*?insert into public\.completion_records/)
})
