-- Release 1 progress-integrity migration.
-- Forward-only: preserve all intervals, progress rows, and completion records.
-- Existing sessions are paused with no carried timing budget; their accepted
-- media position is retained so the next page load can resume safely.

set local lock_timeout = '5s';

alter table public.videos
  alter column duration_seconds type numeric(12,3) using duration_seconds::numeric,
  add column if not exists duration_precision_verified boolean not null default false;
alter table public.playback_sessions
  alter column last_position type numeric(12,3) using last_position::numeric;
alter table public.watched_intervals
  alter column start_seconds type numeric(12,3) using start_seconds::numeric,
  alter column end_seconds type numeric(12,3) using end_seconds::numeric;

alter table public.playback_sessions
  add column if not exists session_version bigint not null default 0,
  add column if not exists active_since timestamptz,
  add column if not exists playback_budget_seconds numeric(12,6) not null default 0,
  add column if not exists precision_reserve_seconds numeric(8,6) not null default 0.001,
  add column if not exists last_accepted_request_id uuid;

create table if not exists public.playback_heartbeat_requests (
  session_id uuid not null references public.playback_sessions(id) on delete cascade,
  request_id uuid not null,
  expected_version bigint not null,
  client_sequence bigint not null,
  position numeric not null,
  is_playing boolean not null,
  kind text not null,
  accepted boolean not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(session_id,request_id)
);
create index if not exists playback_heartbeat_requests_created_at
  on public.playback_heartbeat_requests(created_at);
alter table public.playback_heartbeat_requests enable row level security;
revoke all on public.playback_heartbeat_requests from public,anon,authenticated;

update public.playback_sessions
set is_playing = false,
    active_since = null,
    playback_budget_seconds = 0,
    precision_reserve_seconds = 0.001,
    session_version = 0,
    last_accepted_request_id = null,
    last_heartbeat_at = clock_timestamp()
where active;

create or replace function public.start_playback_session(p_video_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); dur numeric; duration_verified boolean; pos numeric:=0; r record; sid uuid; already_done boolean;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  select duration_seconds,duration_precision_verified into dur,duration_verified
    from public.videos where id=p_video_id and published;
  if dur is null or dur<=0 or not coalesce(duration_verified,false) then raise exception 'video duration metadata unavailable'; end if;
  select exists(select 1 from public.completion_records where user_id=uid and video_id=p_video_id) into already_done;
  if not already_done then
    for r in select start_seconds,end_seconds from public.watched_intervals
      where user_id=uid and video_id=p_video_id order by start_seconds,end_seconds loop
      if r.start_seconds > pos then exit; end if;
      pos:=greatest(pos,r.end_seconds);
    end loop;
    pos:=least(pos,dur);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_video_id::text,0));
  update public.playback_sessions set active=false,is_playing=false,active_since=null
    where user_id=uid and video_id=p_video_id and active;
  delete from public.playback_heartbeat_requests q using public.playback_sessions old_session
    where q.session_id=old_session.id and old_session.user_id=uid
      and (old_session.video_id=p_video_id or old_session.started_at<clock_timestamp()-interval '12 hours');
  insert into public.playback_sessions(user_id,video_id,last_position,session_version,
    playback_budget_seconds,precision_reserve_seconds,is_playing,active_since)
    values(uid,p_video_id,pos,0,0,0.001,false,null) returning id into sid;
  update public.profiles set last_seen_at=clock_timestamp() where id=uid;
  return jsonb_build_object('sessionId',sid,'position',pos,'version',0,'isPlaying',false);
end $$;

-- Keep the old signature briefly so requests from old application instances
-- fail closed with an actionable error instead of reaching the old validator.
create or replace function public.record_playback_heartbeat(
  p_session_id uuid,p_position numeric,p_is_playing boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception using errcode='P0001',message='client_upgrade_required';
end $$;

create or replace function public.record_playback_heartbeat(
  p_session_id uuid,
  p_request_id uuid,
  p_expected_version bigint,
  p_client_sequence bigint,
  p_position numeric,
  p_is_playing boolean,
  p_kind text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  s public.playback_sessions%rowtype;
  dur numeric;
  duration_verified boolean;
  saved_request public.playback_heartbeat_requests%rowtype;
  transaction_started_at timestamptz:=transaction_timestamp();
  request_at timestamptz;
  active_elapsed numeric:=0;
  eligible_budget numeric:=0;
  delta numeric:=0;
  pos numeric;
  target_already_watched boolean:=false;
  reposition boolean:=false;
  covered_cursor numeric:=0;
  tolerance_used numeric:=0;
  budget_after numeric:=0;
  tolerance_after numeric:=0;
  interval_inserted boolean:=false;
  r record;
  run_start numeric;
  run_end numeric;
  total numeric:=0;
  complete_coverage boolean:=false;
  done boolean:=false;
  pct numeric:=0;
  new_version bigint;
  response jsonb;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  if p_request_id is null or p_expected_version is null or p_client_sequence is null or
     p_client_sequence<1 or p_position is null or p_position<0 or p_is_playing is null or
     p_kind is null or p_kind not in ('play','pause','periodic','seek','complete','event') then
    return jsonb_build_object('accepted',false,'code','invalid_request','error','Invalid heartbeat request.');
  end if;

  -- The lock is acquired before sampling the authoritative time or reading
  -- the version/position used by this validation.
  select * into s from public.playback_sessions
    where id=p_session_id and user_id=uid and active for update;
  if not found or s.started_at < now()-interval '12 hours' then
    raise exception 'session expired';
  end if;
  request_at:=clock_timestamp();

  -- Persist accepted and rejected receipts. A retry returns the same decision,
  -- including after newer requests, and cannot spend budget twice.
  select * into saved_request from public.playback_heartbeat_requests
    where session_id=s.id and request_id=p_request_id;
  if found then
    if saved_request.expected_version=p_expected_version and
       saved_request.client_sequence=p_client_sequence and saved_request.position=p_position and
       saved_request.is_playing=p_is_playing and saved_request.kind=p_kind then
      return saved_request.response || jsonb_build_object('duplicate',true);
    end if;
    return jsonb_build_object('accepted',false,'code','request_id_reused',
      'error','Request ID was reused with different heartbeat data.','version',s.session_version,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing,
      'transactionStartedAt',transaction_started_at,'requestAt',request_at,
      'previousHeartbeatAt',s.last_heartbeat_at);
  end if;
  -- Bound retained request receipts per live session (including rejected
  -- attempts) while keeping ample room for ordinary 8-second heartbeats.
  delete from public.playback_heartbeat_requests q
    where q.session_id=s.id and q.request_id in (
      select old.request_id from public.playback_heartbeat_requests old
      where old.session_id=s.id order by old.created_at desc offset 511
    );
  if p_expected_version<>s.session_version then
    response:=jsonb_build_object('accepted',false,'code','stale_version',
      'error','A newer heartbeat was already accepted for this playback session.',
      'version',s.session_version,'acceptedPosition',s.last_position,
      'serverIsPlaying',s.is_playing,'requestId',p_request_id,
      'transactionStartedAt',transaction_started_at,'requestAt',request_at,
      'previousHeartbeatAt',s.last_heartbeat_at);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  select duration_seconds,duration_precision_verified into dur,duration_verified
    from public.videos where id=s.video_id and published;
  if dur is null or dur<=0 or not coalesce(duration_verified,false) then raise exception 'video duration metadata unavailable'; end if;
  if p_position>dur+1 then
    response:=jsonb_build_object('accepted',false,'code','invalid_position','error','Position exceeds video duration.',
      'version',s.session_version,'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  -- Positions and interval columns use millisecond precision. Quantize once,
  -- before validation, so budget consumption and interval length share endpoints.
  pos:=least(round(p_position,3),dur::numeric);
  delta:=pos-s.last_position;
  active_elapsed:=case when s.is_playing and s.active_since is not null
    then greatest(0,extract(epoch from (request_at-s.active_since))) else 0 end;
  eligible_budget:=s.playback_budget_seconds+active_elapsed;
  tolerance_after:=s.precision_reserve_seconds;

  target_already_watched:=exists(select 1 from public.watched_intervals
    where user_id=uid and video_id=s.video_id and start_seconds<=pos and end_seconds>=pos);
  if delta>0 and target_already_watched then
    covered_cursor:=s.last_position;
    for r in select start_seconds,end_seconds from public.watched_intervals
      where user_id=uid and video_id=s.video_id and end_seconds>=s.last_position
        and start_seconds<=pos order by start_seconds,end_seconds loop
      if r.start_seconds>covered_cursor then exit; end if;
      covered_cursor:=greatest(covered_cursor,r.end_seconds);
      if covered_cursor>=pos then reposition:=true; exit; end if;
    end loop;
  end if;

  if p_kind='seek' and delta>0 and target_already_watched and not reposition then
    response:=jsonb_build_object('accepted',false,'code','unwatched_forward_seek',
      'error','Cannot seek across a section that has not been verified as watched.',
      'version',s.session_version,'acceptedPosition',s.last_position,'requestedPosition',pos,
      'serverIsPlaying',s.is_playing,
      'transactionStartedAt',transaction_started_at,'requestAt',request_at,
      'previousHeartbeatAt',s.last_heartbeat_at);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  if delta<0 and not target_already_watched then
    response:=jsonb_build_object('accepted',false,'code','unwatched_backward_seek',
      'error','Cannot seek to an unwatched section.','version',s.session_version,
      'acceptedPosition',s.last_position,'requestedPosition',pos,
      'serverIsPlaying',s.is_playing,
      'transactionStartedAt',transaction_started_at,'requestAt',request_at,
      'previousHeartbeatAt',s.last_heartbeat_at);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  -- Repositioning to verified coverage earns no new coverage and costs no
  -- playback budget. New forward coverage must be paid from server time.
  if delta>0 and not reposition then
    if delta>eligible_budget+s.precision_reserve_seconds then
      response:=jsonb_build_object('accepted',false,'code','playback_budget_exceeded',
        'error','Playback advanced beyond server-accounted active time.',
        'version',s.session_version,'acceptedPosition',s.last_position,'requestedPosition',pos,
        'serverIsPlaying',s.is_playing,
        'serverElapsed',active_elapsed,'storedBudget',s.playback_budget_seconds,
        'eligibleBudget',eligible_budget,'allowedAdvance',eligible_budget+s.precision_reserve_seconds,
        'actualAdvance',delta,'sessionWasPlaying',s.is_playing,'activeSince',s.active_since,
        'requestAt',request_at,'transactionStartedAt',transaction_started_at,
        'previousHeartbeatAt',s.last_heartbeat_at);
      insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
        client_sequence,position,is_playing,kind,accepted,response)
        values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
      return response;
    end if;
    if delta>eligible_budget then tolerance_used:=delta-eligible_budget; end if;
    budget_after:=greatest(0,eligible_budget-delta);
  else
    budget_after:=eligible_budget;
  end if;

  if delta>0 and not reposition then
    if pos>s.last_position then
      insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds)
        values(uid,s.video_id,s.last_position,pos);
      interval_inserted:=true;
    end if;
  end if;

  tolerance_after:=greatest(0,s.precision_reserve_seconds-tolerance_used);
  -- A pause/buffering transition flushes its final verified advancement, then
  -- discards unused active-time budget so paused time cannot spend it later.
  if not p_is_playing then
    budget_after:=0;
  end if;
  new_version:=s.session_version+1;

  -- Build one normalized interval union. The only gap allowance is zero: the
  -- stored millisecond boundaries are shared exactly for valid adjacent
  -- heartbeats. Boundary tolerance is half a stored unit (0.0005 seconds).
  run_start:=null;run_end:=null;
  for r in select start_seconds,end_seconds from public.watched_intervals
    where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end then
      run_end:=greatest(run_end,r.end_seconds);
    else
      total:=total+(run_end-run_start);
      if run_start<=0.0005 and run_end>=dur-0.0005 then complete_coverage:=true; end if;
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then
    total:=total+(run_end-run_start);
    if run_start<=0.0005 and run_end>=dur-0.0005 then complete_coverage:=true; end if;
  end if;
  done:=complete_coverage;
  pct:=least(100,round(total/greatest(dur,1)*100,1));

  insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at,updated_at)
    values(uid,s.video_id,total,case when done then request_at else null end,request_at)
    on conflict(user_id,video_id) do update set
      watched_seconds=excluded.watched_seconds,
      completed_at=case when public.user_video_progress.completed_at is not null
        then public.user_video_progress.completed_at else excluded.completed_at end,
      updated_at=request_at;
  if done then
    insert into public.completion_records(user_id,video_id,method)
      values(uid,s.video_id,'playback') on conflict(user_id,video_id) do nothing;
  end if;

  response:=jsonb_build_object('accepted',true,'duplicate',false,'version',new_version,
    'acceptedPosition',pos,'percent',pct,'complete',done,'intervalInserted',interval_inserted,
    'intervals',(select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,
      'end_seconds',end_seconds) order by start_seconds,end_seconds),'[]'::jsonb)
      from public.watched_intervals where user_id=uid and video_id=s.video_id),
    'serverIsPlaying',p_is_playing,'budgetSeconds',budget_after,
    'precisionReserveSeconds',tolerance_after,'requestAt',request_at,
    'transactionStartedAt',transaction_started_at,
    'previousHeartbeatAt',s.last_heartbeat_at,'previousPosition',s.last_position,
    'serverElapsed',eligible_budget-s.playback_budget_seconds,'actualAdvance',delta,
    'sessionVersion',s.session_version,'requestId',p_request_id);

  update public.playback_sessions set
    last_position=pos,
    last_heartbeat_at=request_at,
    is_playing=p_is_playing,
    active_since=case when p_is_playing then request_at else null end,
    playback_budget_seconds=budget_after,
    precision_reserve_seconds=tolerance_after,
    session_version=new_version,
    last_accepted_request_id=p_request_id
    where id=s.id;
  insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
    client_sequence,position,is_playing,kind,accepted,response)
    values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,true,response);
  update public.profiles set last_seen_at=request_at where id=uid;
  return response;
exception when check_violation then
  raise exception 'watched interval constraint failure: session %, prior position %, requested position %, duration %',
    p_session_id,s.last_position,p_position,dur;
end $$;

revoke all on function public.record_playback_heartbeat(uuid,numeric,boolean) from public;
revoke all on function public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text) from public;
grant execute on function public.record_playback_heartbeat(uuid,numeric,boolean) to authenticated;
grant execute on function public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text) to authenticated;
