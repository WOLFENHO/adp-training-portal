-- Gold Rehearsal media-end tolerance correction. Applies after Release 1.2.1 and Gold migrations.
-- A matching accepted complete heartbeat, asset identity, and contiguous verified intervals are required.
-- Preserves the original 100 ms or 1% bound, whichever is smaller.
CREATE OR REPLACE FUNCTION public.adp_refresh_verified_progress_r12(p_user_id uuid, p_video_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v public.videos%rowtype;
  r record;
  run_start numeric;
  run_end numeric;
  covered numeric:=0;
  completion_end numeric;
  is_complete boolean:=false;
  completed_at_value timestamptz:=clock_timestamp();
begin
  select * into v from public.videos where id=p_video_id;
  if not found then raise exception 'video not found'; end if;
  -- Use the same millisecond grid as the heartbeat validator. This is an
  -- independently verified media endpoint, never the client's ended position.
  select floor(e.media_end_seconds * 1000) / 1000 into completion_end
    from public.adp_verified_media_ends e
    where e.video_id=v.id and e.asset_identity=public.adp_asset_identity(v)
      and e.playback_id=v.playback_id and e.media_end_seconds<=v.duration_seconds
      and v.duration_seconds - floor(e.media_end_seconds * 1000) / 1000
        <= least(0.100, v.duration_seconds / 100);
  completion_end:=coalesce(completion_end,
    case when exists (
      select 1 from public.playback_heartbeat_requests h
      join public.playback_sessions ps on ps.id=h.session_id
      where ps.user_id=p_user_id and ps.video_id=p_video_id
        and ps.asset_identity=public.adp_asset_identity(v)
        and h.kind='complete' and h.accepted
        and h.position>=v.duration_seconds-least(0.100,v.duration_seconds/100)
    ) then v.duration_seconds-least(0.100,v.duration_seconds/100)
    else v.duration_seconds end);
  for r in
    select start_seconds,
      case when v.duration_precision_verified then completion_end_seconds else end_seconds end as end_seconds
    from public.watched_intervals
    where user_id=p_user_id and video_id=p_video_id
      and verification_source='release_1_2' and reset_at is null and asset_identity=public.adp_asset_identity(v)
      and (not v.duration_precision_verified or completion_eligible)
      and (case when v.duration_precision_verified then completion_end_seconds else end_seconds end)>start_seconds
    order by start_seconds,end_seconds
  loop
    if run_start is null then
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end then
      run_end:=greatest(run_end,r.end_seconds);
    else
      covered:=covered+(run_end-run_start);
      if run_start=0 and run_end>=completion_end then is_complete:=true; end if;
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then
    covered:=covered+(run_end-run_start);
    if run_start=0 and run_end>=completion_end then is_complete:=true; end if;
  end if;
  is_complete:=v.duration_precision_verified and v.asset_id is not null and is_complete;

  insert into public.user_video_progress(user_id,video_id,watched_seconds,verified_watched_seconds,updated_at)
    values(p_user_id,p_video_id,0,covered,completed_at_value)
    on conflict(user_id,video_id) do update set
      verified_watched_seconds=excluded.verified_watched_seconds,
      updated_at=excluded.updated_at;

  if is_complete then
    insert into public.verified_completion_records(user_id,video_id,asset_id,duration_seconds,completed_at,asset_identity,verified_at)
      values(p_user_id,p_video_id,v.asset_id,v.duration_seconds,completed_at_value,public.adp_asset_identity(v),completed_at_value)
      on conflict(user_id,video_id,asset_id,duration_seconds) do update set
      verified_at=case when verified_completion_records.asset_identity is null or verified_completion_records.reset_at is not null
        then excluded.completed_at else verified_completion_records.verified_at end,
      asset_identity=excluded.asset_identity,reset_at=null;
    -- Verified completion has its own versioned table above. Do not write it
    -- into completion_records: that table is historical provenance only.
  end if;
  return jsonb_build_object('verifiedWatchedSeconds',covered,'verifiedComplete',is_complete,
    'durationVerified',v.duration_precision_verified,'assetId',v.asset_id,
    'durationSeconds',v.duration_seconds);
end $function$
;
