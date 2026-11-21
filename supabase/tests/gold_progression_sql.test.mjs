import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('server-owned progression checks exact verified asset and revokes direct legacy RPC access', () => {
  const sql = readFileSync('supabase/batch3/gold_training_sequence_candidate.sql', 'utf8')
  for (const condition of ['proof.user_id=auth.uid()', 'proof.video_id=prior.id',
    'proof.asset_id=prior.asset_id', 'proof.duration_seconds=prior.duration_seconds',
    'proof.validator_version=12', 'proof.reset_at is null', 'proof.verified_at is not null',
    'proof.asset_identity=public.adp_asset_identity(prior)']) assert.ok(sql.includes(condition), condition)
  assert.doesNotMatch(sql, /from public\.completion_records/)
  assert.match(sql, /revoke all on function public\.start_playback_session_r12[\s\S]*record_playback_heartbeat_r12[\s\S]*from public,anon,authenticated;/)
  assert.match(sql, /grant execute on function public\.adp_training_unlocked_r121[\s\S]*to authenticated;/)
  assert.match(sql, /owner_id is distinct from auth\.uid\(\)/)
  assert.match(sql, /playback_control where singleton and enabled/)
  const enable = readFileSync('supabase/deployment/release_1_2_1_enable_playback.sql', 'utf8')
  const disable = readFileSync('supabase/deployment/release_1_2_1_disable_playback.sql', 'utf8')
  assert.match(enable, /grant execute on function public\.adp_training_unlocked_r121[\s\S]*to authenticated;/)
  assert.doesNotMatch(enable, /grant execute on function public\.start_playback_session_r12\(uuid\) to authenticated/)
  assert.match(disable, /'public\.adp_training_heartbeat_r121\(/)
})
