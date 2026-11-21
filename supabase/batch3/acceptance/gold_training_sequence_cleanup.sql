-- ADP-Rehearsal only, after disposable fixtures and sessions have been removed.
-- Do not use for Production without comparing fresh preinstallation ACLs.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $$ begin
  if current_user<>'postgres' or not exists(select 1 from public.adp_playback_control where singleton and not enabled) or
     exists(select 1 from public.playback_sessions where active) then
    raise exception 'progression cleanup preconditions failed';
  end if;
end $$;
drop function public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text);
drop function public.adp_training_start_session_r121(uuid);
drop function public.adp_training_unlocked_r121(uuid);
grant execute on function public.start_playback_session_r12(uuid),
  public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)
  to authenticated;
commit;
