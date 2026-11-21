import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyNewMuxUpload } from '../../src/lib/mux-duration-sync.mjs'

test('new upload metadata requires exact Mux identities and an atomic database acceptance', async () => {
  const videoId = 'video-1', uploadId = 'upload-1'
  let upload = { id: uploadId, status: 'asset_created', asset_id: 'asset-1', new_asset_settings: { passthrough: videoId } }
  let asset = { id: 'asset-1', status: 'ready', duration: 16.7, playback_ids: [{ policy: 'signed', id: 'playback-1' }] }
  let writes = 0, accepted = true
  const deps = { mux: { video: { uploads: { retrieve: async () => upload }, assets: { retrieve: async () => asset } } },
    adminDb: { rpc: async (name, args) => { writes++; assert.equal(name, 'adp_verify_new_upload_qc026');
      assert.equal(args.p_video_id, videoId); assert.equal(args.p_upload_id, uploadId);
      assert.equal(args.p_asset_id, 'asset-1'); assert.equal(args.p_playback_id, 'playback-1');
      return { data: accepted, error: null } } } }
  const verify = () => verifyNewMuxUpload({ videoId, uploadId, actorId: 'admin' }, deps)
  assert.deepEqual(await verify(), { verified: true })
  accepted = false
  assert.deepEqual(await verify(), { verified: false })
  writes = 0; accepted = true
  upload = { ...upload, new_asset_settings: { passthrough: 'wrong' } }
  assert.deepEqual(await verify(), { verified: false })
  upload = { ...upload, new_asset_settings: { passthrough: videoId } }
  asset = { ...asset, id: 'wrong' }
  assert.deepEqual(await verify(), { verified: false })
  asset = { ...asset, id: 'asset-1', playback_ids: [{ policy: 'public', id: 'playback-1' }] }
  assert.deepEqual(await verify(), { verified: false })
  assert.equal(writes, 0)
})

test('new-upload SQL refuses videos with any progress or completion evidence', () => {
  const sql = readFileSync('supabase/batch3/qc026_reconcile_extension.sql', 'utf8')
  for (const table of ['user_video_progress','watched_intervals','playback_sessions','completion_records','verified_completion_records']) {
    assert.match(sql, new RegExp(`exists\\(select 1 from public\\.${table} where video_id=p_video_id\\)`))
  }
  assert.match(sql, /v\.published or v\.mux_upload_id is distinct from p_upload_id/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_asset_id,26\)\)/)
  assert.match(sql, /exists\(select 1 from public\.videos where id<>p_video_id and/)
  assert.match(sql, /update public\.videos set asset_id=p_asset_id,playback_id=p_playback_id/)
  assert.match(sql, /update public\.adp_upload_intents set state='asset_created'/)
  assert.match(sql, /revoke all on function public\.adp_verify_new_upload_qc026[\s\S]*from public,anon,authenticated,service_role/)
})
