-- Isolated candidate. Requires fresh Release 121 function and ACL fingerprints.
-- Apply only while both playback controls are OFF and no active sessions exist.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $$ begin
  if current_user <> 'postgres' or
     to_regprocedure('public.start_playback_session_r12(uuid)') is null or
     to_regprocedure('public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)') is null or
     to_regprocedure('public.adp_asset_identity(public.videos)') is null or
     not exists(select 1 from public.adp_integrity_release where singleton and version=121 and ready) or
     exists(select 1 from public.adp_playback_control where singleton and enabled) then
    raise exception 'Release 121 maintenance precondition failed';
  end if;
end $$;

create function public.adp_training_unlocked_r121(p_video_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and public.is_authorized() and exists(
    select 1 from public.videos target
    where target.id=p_video_id and target.published and
      not exists (
        select 1 from public.videos prior
        where prior.published and (prior.sort_order,prior.id)<(target.sort_order,target.id)
          and not exists (
            select 1 from public.verified_completion_records proof
            where proof.user_id=auth.uid() and proof.video_id=prior.id and
              proof.asset_id=prior.asset_id and proof.duration_seconds=prior.duration_seconds and
              proof.validator_version=12 and proof.reset_at is null and proof.verified_at is not null and
              proof.asset_identity=public.adp_asset_identity(prior)
          )
      )
  )
$$;

create function public.adp_training_start_session_r121(p_video_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.adp_training_unlocked_r121(p_video_id) then
    raise exception using errcode='42501',message='training_locked';
  end if;
  return public.start_playback_session_r12(p_video_id);
end $$;

create function public.adp_training_heartbeat_r121(
  p_session_id uuid,p_request_id uuid,p_expected_version bigint,
  p_client_sequence bigint,p_position numeric,p_is_playing boolean,p_kind text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid; owner_id uuid;
begin
  select video_id,user_id into target,owner_id from public.playback_sessions where id=p_session_id;
  if found then
    if owner_id is distinct from auth.uid() then
      raise exception using errcode='42501',message='not authorized';
    end if;
    if not public.adp_training_unlocked_r121(target) then
      raise exception using errcode='42501',message='training_locked';
    end if;
  end if;
  return public.record_playback_heartbeat_r12(p_session_id,p_request_id,p_expected_version,
    p_client_sequence,p_position,p_is_playing,p_kind);
end $$;

-- The owning wrappers may invoke the original functions. Client roles must
-- not call the originals directly to skip the progression check.
revoke all on function public.start_playback_session_r12(uuid),
  public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)
  from public,anon,authenticated;
revoke all on function public.adp_training_unlocked_r121(uuid),
  public.adp_training_start_session_r121(uuid),
  public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.adp_training_unlocked_r121(uuid),
  public.adp_training_start_session_r121(uuid),
  public.adp_training_heartbeat_r121(uuid,uuid,bigint,bigint,numeric,boolean,text)
  to authenticated;
commit;
