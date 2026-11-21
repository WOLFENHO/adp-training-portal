-- Run as the database owner only after migration 007 and verification.
-- Restores only the intended authenticated R1.2 RPC access. It does not
-- attempt to reconstruct arbitrary project ACLs; the capture query is evidence.
begin;
set local lock_timeout='5s';
do $$
declare version_value integer;ready_value boolean;
begin
  if to_regclass('public.adp_integrity_release') is null or
     to_regclass('public.adp_playback_control') is null or
     to_regprocedure('public.start_playback_session_r12(uuid)') is null or
     to_regprocedure('public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)') is null or
     to_regprocedure('public.adp_training_unlocked_r121(uuid)') is null or
     to_regprocedure('public.adp_training_start_session_r121(uuid)') is null or
     to_regprocedure('public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text)') is null then
    raise exception 'Release 1.2 playback schema is incomplete; refusing to enable';
  end if;
  select version,ready into version_value,ready_value
    from public.adp_integrity_release where singleton for update;
  if version_value<>121 or ready_value is distinct from true then
    raise exception 'Release 1.2 integrity marker is not ready (version %, ready %)',version_value,ready_value;
  end if;
  update public.adp_playback_control set enabled=true,updated_at=clock_timestamp() where singleton;
  if not found then raise exception 'Playback control row is missing'; end if;
end $$;
-- Scrub direct non-owner grants, including custom default privileges. Restore only reviewed roles below.
do $$ declare target regprocedure; g record; signature text;
begin
 foreach signature in array array[
 'public.start_playback_session(uuid)',
 'public.record_playback_heartbeat(uuid,numeric,boolean)',
 'public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text)',
 'public.start_playback_session_r11(uuid)',
 'public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text)',
 'public.start_playback_session_r12(uuid)',
 'public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)',
 'public.adp_training_unlocked_r121(uuid)',
 'public.adp_training_start_session_r121(uuid)',
 'public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text)',
 'public.adp_admin_progress(uuid,uuid,text)',
 'public.adp_sync_verified_duration(uuid,text,text,numeric)'
 ] loop
 target:=to_regprocedure(signature);
 if target is null then raise exception 'Required function missing: %',signature;end if;
 for g in select distinct a.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid=target and a.privilege_type='EXECUTE' and a.grantee<>p.proowner loop
 if g.grantee=0 then execute format('revoke execute on function %s from public cascade',target);
 else execute format('revoke execute on function %s from %I cascade',target,pg_get_userbyid(g.grantee));end if;
 end loop;
 end loop;
end$$;
revoke execute on function public.start_playback_session_r12(uuid) from public,anon,authenticated;
revoke execute on function public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon,authenticated;
grant execute on function public.adp_training_unlocked_r121(uuid),
 public.adp_training_start_session_r121(uuid),
 public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text) to authenticated;
revoke all on function public.adp_admin_progress(uuid,uuid,text) from public,anon;
grant execute on function public.adp_admin_progress(uuid,uuid,text) to authenticated;
revoke all on function public.adp_sync_verified_duration(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.adp_sync_verified_duration(uuid,text,text,numeric) to service_role;
commit;
