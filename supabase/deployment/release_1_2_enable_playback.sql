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
     to_regprocedure('public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)') is null then
    raise exception 'Release 1.2 playback schema is incomplete; refusing to enable';
  end if;
  select version,ready into version_value,ready_value
    from public.adp_integrity_release where singleton for update;
  if version_value<>12 or ready_value is distinct from true then
    raise exception 'Release 1.2 integrity marker is not ready (version %, ready %)',version_value,ready_value;
  end if;
  update public.adp_playback_control set enabled=true,updated_at=clock_timestamp() where singleton;
  if not found then raise exception 'Playback control row is missing'; end if;
end $$;
revoke execute on function public.start_playback_session_r12(uuid) from public,anon;
revoke execute on function public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon;
grant execute on function public.start_playback_session_r12(uuid) to authenticated;
grant execute on function public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text) to authenticated;
commit;
