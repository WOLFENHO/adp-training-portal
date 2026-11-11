-- The original numeric(10,2) interval columns round both boundaries on insert.
-- A positive delta smaller than the storage precision can therefore become
-- end_seconds = start_seconds and violate watched_intervals_check.
create or replace function public.record_playback_heartbeat(p_session_id uuid,p_position numeric,p_is_playing boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid(); s public.playback_sessions%rowtype; dur integer;
  elapsed numeric; delta numeric; allowed numeric; pos numeric; interval_start numeric; interval_end numeric; request_at timestamptz; target_already_watched boolean;
  r record; run_start numeric; run_end numeric; covered numeric:=0; total numeric:=0; pct numeric:=0; done boolean:=false;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  select * into s from public.playback_sessions where id=p_session_id and user_id=uid and active for update;
  if not found or s.started_at < now()-interval '12 hours' then raise exception 'session expired'; end if;
  select duration_seconds into dur from public.videos where id=s.video_id and published;
  if dur is null or dur<=0 then raise exception 'video unavailable'; end if;
  if p_position is null or p_position < 0 or p_position > dur+1 then raise exception 'invalid position'; end if;
  pos:=least(p_position,dur::numeric);
  request_at:=clock_timestamp();
  elapsed:=case when s.is_playing then greatest(0,extract(epoch from (request_at-s.last_heartbeat_at))) else 0 end;
  delta:=pos-s.last_position;
  allowed:=elapsed*1.25+2.5;
  target_already_watched:=exists(select 1 from public.watched_intervals where user_id=uid and video_id=s.video_id and start_seconds<=pos and end_seconds>=pos);
  if delta > allowed and not target_already_watched then
    raise exception 'playback advanced too quickly: previous_position %, requested_position %, server_elapsed %, allowed_advance %, actual_advance %, previous_heartbeat_at %, request_at %, session_was_playing %',
      s.last_position,pos,elapsed,allowed,delta,s.last_heartbeat_at,request_at,s.is_playing;
  end if;
  if delta < -0.5 and not exists(select 1 from public.watched_intervals where user_id=uid and video_id=s.video_id and start_seconds<=pos and end_seconds>=pos) then raise exception 'cannot seek to an unwatched section'; end if;
  if delta > 0 and not target_already_watched then
    -- Match the column scale before checking the constraint. Sub-centisecond
    -- deltas round to an empty interval and are ignored safely.
    interval_start:=greatest(0,round(s.last_position,2));
    interval_end:=least(dur::numeric,round(pos,2));
    if interval_end>interval_start then
      insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds)
      values(uid,s.video_id,interval_start,interval_end);
    end if;
  end if;
  update public.playback_sessions set last_position=pos,last_heartbeat_at=request_at,is_playing=p_is_playing where id=s.id;
  update public.profiles set last_seen_at=now() where id=uid;
  for r in select start_seconds,end_seconds from public.watched_intervals where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end+0.05 then run_end:=greatest(run_end,r.end_seconds);
    else total:=total+(run_end-run_start);run_start:=r.start_seconds;run_end:=r.end_seconds; end if;
  end loop;
  if run_start is not null then total:=total+(run_end-run_start); end if;
  covered:=0;run_start:=null;run_end:=null;
  for r in select start_seconds,end_seconds from public.watched_intervals where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end+0.75 then run_end:=greatest(run_end,r.end_seconds);
    else if run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if;run_start:=r.start_seconds;run_end:=r.end_seconds; end if;
  end loop;
  if run_start is not null and run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if;
  done:=covered>=dur;pct:=least(100,round(total/greatest(dur,1)*100,1));
  insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at,updated_at)
  values(uid,s.video_id,total,case when done then now() else null end,now())
  on conflict(user_id,video_id) do update set watched_seconds=excluded.watched_seconds,
    completed_at=case when public.user_video_progress.completed_at is not null then public.user_video_progress.completed_at else excluded.completed_at end,updated_at=now();
  if done then insert into public.completion_records(user_id,video_id,method) values(uid,s.video_id,'playback') on conflict(user_id,video_id) do nothing; end if;
  return jsonb_build_object('acceptedPosition',pos,'percent',pct,'complete',done,
    'intervals',(select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,'end_seconds',end_seconds) order by start_seconds),'[]'::jsonb) from public.watched_intervals where user_id=uid and video_id=s.video_id));
exception when check_violation then
  raise exception 'watched interval constraint failure: session %, raw start %, raw end %, duration %, sqlstate %',p_session_id,s.last_position,p_position,dur,sqlstate;
end $$;
revoke all on function public.record_playback_heartbeat(uuid,numeric,boolean) from public;
grant execute on function public.record_playback_heartbeat(uuid,numeric,boolean) to authenticated;
