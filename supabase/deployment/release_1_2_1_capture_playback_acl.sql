-- Read-only preflight: capture direct EXECUTE grants on ADP playback RPCs.
-- Save the result securely before maintenance; do not execute the output as-is.
with targets(signature) as (values
  ('public.adp_admin_progress(uuid,uuid,text)'),
  ('public.adp_sync_verified_duration(uuid,text,text,numeric)'),
  ('public.start_playback_session(uuid)'),
  ('public.record_playback_heartbeat(uuid,numeric,boolean)'),
  ('public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text)'),
  ('public.start_playback_session_r11(uuid)'),
  ('public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text)'),
  ('public.start_playback_session_r12(uuid)'),
  ('public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)')
), resolved as (
  select signature,to_regprocedure(signature) as function_oid from targets
)
select r.signature,
  coalesce(pg_get_userbyid(a.grantee),'PUBLIC') as grantee,
  pg_get_userbyid(a.grantor) as grantor,
  a.privilege_type,a.is_grantable
from resolved r
join pg_proc p on p.oid=r.function_oid
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
where a.privilege_type='EXECUTE'
order by r.signature,grantee,grantor;
