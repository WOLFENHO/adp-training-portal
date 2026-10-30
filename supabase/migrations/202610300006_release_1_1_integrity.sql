-- Release 1.1: cumulative server-time budget, ordered events, durable
-- idempotency receipts, and safe duration reconciliation.
-- Apply with 202610300005 only while the heartbeat API is disabled.
set local lock_timeout = '5s';

alter table public.playback_sessions
  add column if not exists last_event_sequence bigint not null default 0;
alter table public.videos
  add column if not exists legacy_duration_seconds numeric(12,3),
  add column if not exists duration_verified_at timestamptz;
alter table public.watched_intervals
  add column if not exists completion_eligible boolean not null default false,
  add column if not exists completion_end_seconds numeric(12,3);

create table if not exists public.adp_integrity_release(
  singleton boolean primary key default true check(singleton),
  version integer not null,
  ready boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.adp_integrity_release enable row level security;
revoke all on public.adp_integrity_release from public,anon,authenticated;
insert into public.adp_integrity_release(singleton,version,ready,updated_at)
  values(true,11,false,clock_timestamp())
  on conflict(singleton) do update set version=excluded.version,ready=false,updated_at=excluded.updated_at;

update public.videos
set legacy_duration_seconds = duration_seconds
where legacy_duration_seconds is null;
update public.videos
set duration_verified_at = coalesce(updated_at, created_at, clock_timestamp())
where duration_precision_verified and duration_verified_at is null;
update public.watched_intervals i
set completion_eligible = true,
    completion_end_seconds = least(i.end_seconds, v.duration_seconds)
from public.videos v
where v.id=i.video_id and v.duration_precision_verified
  and i.start_seconds < v.duration_seconds;

-- Release 1.1 removes the per-session allowance completely.
alter table public.playback_sessions drop column if exists precision_reserve_seconds;

create or replace function public.adp_playback_integrity_version()
returns integer language sql stable security definer set search_path=public as $$
  select version from public.adp_integrity_release where singleton and ready
$$;
revoke all on function public.adp_playback_integrity_version() from public,anon;
grant execute on function public.adp_playback_integrity_version() to authenticated;

-- The old entry points fail closed. Release 1.1 uses distinct RPC names, so an
-- application deployment cannot accidentally fall back to the older validator.
create or replace function public.start_playback_session(p_video_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception using errcode='P0001', message='client_upgrade_required';
end $$;

create or replace function public.record_playback_heartbeat(
  p_session_id uuid,p_position numeric,p_is_playing boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception using errcode='P0001', message='client_upgrade_required';
end $$;

create or replace function public.record_playback_heartbeat(
  p_session_id uuid,p_request_id uuid,p_expected_version bigint,
  p_client_sequence bigint,p_position numeric,p_is_playing boolean,p_kind text
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception using errcode='P0001', message='client_upgrade_required';
end $$;

create or replace function public.start_playback_session_r11(p_video_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  dur numeric;
  verified boolean;
  pos numeric:=0;
  cur numeric:=0;
  r record;
  sid uuid;
  expires_at timestamptz;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  -- Serialize session replacement with another start for this user/video.
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_video_id::text,0));
  select duration_seconds,duration_precision_verified into dur,verified
    from public.videos where id=p_video_id and published for share;
  if dur is null or dur<=0 then raise exception 'video unavailable'; end if;

  -- Verified videos resume only from completion-eligible historical coverage.
  -- Unverified published videos remain playable, but cannot earn completion.
  if verified then
    for r in select start_seconds,completion_end_seconds from public.watched_intervals
      where user_id=uid and video_id=p_video_id and completion_eligible
        and completion_end_seconds>start_seconds order by start_seconds,completion_end_seconds loop
      if r.start_seconds>cur then exit; end if;
      cur:=greatest(cur,r.completion_end_seconds);
    end loop;
  else
    for r in select start_seconds,end_seconds from public.watched_intervals
      where user_id=uid and video_id=p_video_id order by start_seconds,end_seconds loop
      if r.start_seconds>cur then exit; end if;
      cur:=greatest(cur,r.end_seconds);
    end loop;
  end if;
  pos:=least(cur,dur);

  update public.playback_sessions set active=false,is_playing=false,active_since=null,
      playback_budget_seconds=0
    where user_id=uid and video_id=p_video_id and active;
  -- Receipts for replaced sessions are retained until their 12-hour expiry.
  insert into public.playback_sessions(user_id,video_id,last_position,session_version,
      last_event_sequence,playback_budget_seconds,is_playing,active_since)
    values(uid,p_video_id,pos,0,0,0,false,null)
    returning id,started_at+interval '12 hours' into sid,expires_at;
  update public.profiles set last_seen_at=clock_timestamp() where id=uid;
  return jsonb_build_object('sessionId',sid,'position',pos,'version',0,
      'lastEventSequence',0,'isPlaying',false,'durationVerified',coalesce(verified,false),
      'sessionExpiresAt',expires_at);
end $$;

create or replace function public.adp_sync_verified_duration(
  p_video_id uuid,p_asset_id text,p_playback_id text,p_duration numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  old_duration numeric;
  verified_duration numeric;
  matching boolean;
  completion_cap numeric;
  changed integer;
  verified_at timestamptz:=clock_timestamp();
begin
  if auth.uid() is not null and not public.is_administrator() then raise exception 'not authorized'; end if;
  if p_video_id is null or p_asset_id is null or p_playback_id is null or
     p_duration is null or p_duration<=0 or p_duration>999999999 then
    raise exception 'invalid verified duration';
  end if;
  verified_duration:=round(p_duration,3);
  select legacy_duration_seconds into old_duration from public.videos
    where id=p_video_id for update;
  if not found then raise exception 'video not found'; end if;
  matching:=old_duration is not null and abs(old_duration-verified_duration)<=0.0005;
  update public.videos set asset_id=p_asset_id,playback_id=p_playback_id,
      duration_seconds=verified_duration,duration_precision_verified=true,
      duration_verified_at=verified_at,updated_at=verified_at
    where id=p_video_id;
  -- Keep every historical row. If duration changed, retain historical coverage
  -- up to the common range but require a fresh final millisecond; the old
  -- endpoint alone cannot certify a changed media endpoint.
  completion_cap:=case when matching then verified_duration
      else greatest(0,least(coalesce(old_duration,0),verified_duration)-0.001) end;
  update public.watched_intervals set
      completion_eligible=(start_seconds<completion_cap and end_seconds>start_seconds),
      completion_end_seconds=case when start_seconds<completion_cap
        then least(end_seconds,completion_cap) else null end
    where video_id=p_video_id and created_at<=verified_at;
  get diagnostics changed=row_count;
  return jsonb_build_object('ok',true,'duration',verified_duration,
      'legacyDuration',old_duration,'durationMatched',matching,
      'completionEligibleIntervalRows',changed,'durationVerifiedAt',verified_at);
end $$;
revoke all on function public.adp_sync_verified_duration(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.adp_sync_verified_duration(uuid,text,text,numeric) to service_role;

create or replace function public.record_playback_heartbeat_r11(
  p_session_id uuid,p_request_id uuid,p_expected_version bigint,
  p_client_sequence bigint,p_position numeric,p_is_playing boolean,p_kind text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid(); s public.playback_sessions%rowtype;
  v public.videos%rowtype; receipt public.playback_heartbeat_requests%rowtype;
  tx_at timestamptz:=transaction_timestamp(); request_at timestamptz;
  elapsed numeric:=0; eligible numeric:=0; delta numeric:=0; pos numeric;
  was_reposition boolean:=false; target_covered boolean:=false;
  cursor_at numeric:=0; r record; run_start numeric; run_end numeric;
  total numeric:=0; display_total numeric:=0; complete_coverage boolean:=false;
  is_complete boolean:=false; pct numeric:=0; next_version bigint;
  response jsonb;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  -- Validate structure and event semantics before ownership/session sequence state.
  if p_session_id is null or p_request_id is null or p_expected_version is null or
     p_expected_version<0 or p_client_sequence is null or p_client_sequence<1 or
     p_position is null or p_position<0 or p_is_playing is null or p_kind is null or
     p_kind not in ('play','pause','buffering','periodic','seek','complete') then
    return jsonb_build_object('accepted',false,'code','invalid_request',
      'error','Heartbeat shape or event type is invalid.');
  end if;
  -- Lock by owner before looking up or changing event ordering. A request for
  -- another user's, inactive, or expired session cannot consume a sequence.
  select * into s from public.playback_sessions
    where id=p_session_id and user_id=uid for update;
  if not found then raise exception using errcode='P0001',message='session_invalid'; end if;
  request_at:=clock_timestamp();

  -- Duplicates are checked before stale sequence/version validation and return
  -- the exact original decision. Receipts are never pruned while session-valid.
  select * into receipt from public.playback_heartbeat_requests
    where session_id=s.id and request_id=p_request_id;
  if found then
    if receipt.expected_version=p_expected_version and receipt.client_sequence=p_client_sequence and
       receipt.position=p_position and receipt.is_playing=p_is_playing and receipt.kind=p_kind then
      return receipt.response || jsonb_build_object('duplicate',true,
          'currentVersion',s.session_version,'currentLastEventSequence',s.last_event_sequence,
          'currentServerIsPlaying',s.is_playing,'currentAcceptedPosition',s.last_position);
    end if;
    return jsonb_build_object('accepted',false,'code','request_id_reused',
      'error','Request ID was already used with different data.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position,
      'serverIsPlaying',s.is_playing);
  end if;

  if request_at>=s.started_at+interval '12 hours' then
    update public.playback_sessions set active=false,is_playing=false,active_since=null,
        playback_budget_seconds=0 where id=s.id;
    response:=jsonb_build_object('accepted',false,'code','session_expired',
      'error','Playback session expired; reopen the lesson.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position,
      'sessionExpiresAt',s.started_at+interval '12 hours');
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  if not s.active then
    return jsonb_build_object('accepted',false,'code','session_inactive',
      'error','A newer playback session replaced this session. Reopen the lesson.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position);
  end if;

  -- State/event mismatch is a validly addressed but semantically invalid event.
  -- It gets a stable receipt and current server state, but consumes no sequence.
  if (p_kind in ('play','periodic') and not p_is_playing) or
     (p_kind in ('pause','buffering','complete') and p_is_playing) or
     (p_kind='seek' and p_is_playing is distinct from s.is_playing) then
    response:=jsonb_build_object('accepted',false,'code','invalid_event_state',
      'error','Event type and requested playback state do not match.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  -- A bounded jump avoids allowing a malicious integer to poison the session.
  -- Rejected business events with a reasonable newer sequence advance this
  -- high-water mark so older delayed transitions cannot take effect later.
  if p_client_sequence<=s.last_event_sequence then
    response:=jsonb_build_object('accepted',false,'code','stale_event',
      'error','A newer event was already observed for this session.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  if p_client_sequence>s.last_event_sequence+10000 then
    response:=jsonb_build_object('accepted',false,'code','sequence_out_of_range',
      'error','Event sequence is outside the permitted forward window; reopen playback.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  update public.playback_sessions set last_event_sequence=p_client_sequence where id=s.id;
  s.last_event_sequence:=p_client_sequence;

  if p_expected_version<>s.session_version then
    response:=jsonb_build_object('accepted',false,'code','stale_version',
      'error','A newer heartbeat changed this session. The next event can resynchronize.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  -- Duration synchronization takes an update lock on this row. Holding a share
  -- lock makes interval eligibility atomic with the verified duration version.
  select * into v from public.videos where id=s.video_id and published for share;
  if not found or v.duration_seconds<=0 then
    response:=jsonb_build_object('accepted',false,'code','video_unavailable',
      'error','Video is unavailable.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  if p_position>v.duration_seconds+1 then
    response:=jsonb_build_object('accepted',false,'code','invalid_position',
      'error','Position exceeds video duration.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  -- Floor to stored precision: no per-request epsilon is granted.
  pos:=least(floor(p_position*1000)/1000,v.duration_seconds);
  delta:=pos-s.last_position;
  -- request_at and the accepted session state are authoritative for elapsed
  -- budget. is_playing is still client-originated state, not Mux playback proof.
  elapsed:=case when s.is_playing and s.active_since is not null
    then greatest(0,extract(epoch from (request_at-s.active_since))) else 0 end;
  eligible:=s.playback_budget_seconds+elapsed;
  target_covered:=exists(select 1 from public.watched_intervals
    where user_id=uid and video_id=s.video_id and start_seconds<=pos and
      (case when v.duration_precision_verified then completion_eligible and completion_end_seconds>=pos
        else end_seconds>=pos end));

  if delta>0 and target_covered then
    cursor_at:=s.last_position;
    for r in select start_seconds,
      case when v.duration_precision_verified then completion_end_seconds else end_seconds end as end_seconds
      from public.watched_intervals where user_id=uid and video_id=s.video_id
        and (not v.duration_precision_verified or completion_eligible)
        and (case when v.duration_precision_verified then completion_end_seconds else end_seconds end)>=s.last_position
        and start_seconds<=pos order by start_seconds,end_seconds loop
      if r.start_seconds>cursor_at then exit; end if;
      cursor_at:=greatest(cursor_at,r.end_seconds);
      if cursor_at>=pos then was_reposition:=true; exit; end if;
    end loop;
  end if;
  if p_kind='seek' and delta>0 and not was_reposition then
    response:=jsonb_build_object('accepted',false,'code','unwatched_forward_seek',
      'error','Cannot seek across a section not previously covered.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  if delta<0 and not target_covered then
    response:=jsonb_build_object('accepted',false,'code','unwatched_backward_seek',
      'error','Cannot seek to an unwatched section.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position,
      'serverIsPlaying',s.is_playing);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;
  if delta>0 and not was_reposition and delta>eligible then
    response:=jsonb_build_object('accepted',false,'code','playback_budget_exceeded',
      'error','Playback advanced beyond server-accounted active time.',
      'version',s.session_version,'lastEventSequence',s.last_event_sequence,
      'acceptedPosition',s.last_position,'serverIsPlaying',s.is_playing,
      'serverElapsed',elapsed,'storedBudget',s.playback_budget_seconds,
      'eligibleBudget',eligible,'actualAdvance',delta,
      'previousHeartbeatAt',s.last_heartbeat_at,'requestAt',request_at);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
      client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,response);
    return response;
  end if;

  if delta>0 and not was_reposition then
    insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds,
      completion_eligible,completion_end_seconds)
    values(uid,s.video_id,s.last_position,pos,v.duration_precision_verified,
      case when v.duration_precision_verified then pos else null end);
  end if;
  if not p_is_playing then eligible:=0;
  elsif delta>0 and not was_reposition then eligible:=greatest(0,eligible-delta); end if;
  next_version:=s.session_version+1;

  -- Normalized all-history coverage drives the percentage; only reconciled,
  -- completion-eligible intervals can satisfy completion.
  run_start:=null;run_end:=null;
  for r in select start_seconds,end_seconds from public.watched_intervals
    where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end then run_end:=greatest(run_end,r.end_seconds);
    else display_total:=display_total+(run_end-run_start);run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then display_total:=display_total+(run_end-run_start); end if;
  run_start:=null;run_end:=null;
  for r in select start_seconds,completion_end_seconds from public.watched_intervals
    where user_id=uid and video_id=s.video_id and completion_eligible
      and completion_end_seconds>start_seconds order by start_seconds,completion_end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.completion_end_seconds;
    elsif r.start_seconds<=run_end then run_end:=greatest(run_end,r.completion_end_seconds);
    else
      total:=total+(run_end-run_start);
      if run_start=0 and run_end>=v.duration_seconds then complete_coverage:=true; end if;
      run_start:=r.start_seconds;run_end:=r.completion_end_seconds;
    end if;
  end loop;
  if run_start is not null then
    total:=total+(run_end-run_start);
    if run_start=0 and run_end>=v.duration_seconds then complete_coverage:=true; end if;
  end if;
  is_complete:=v.duration_precision_verified and complete_coverage;
  pct:=least(100,round((case when v.duration_precision_verified then total else display_total end)
      /greatest(v.duration_seconds,1)*100,1));
  insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at,updated_at)
    values(uid,s.video_id,greatest(total,display_total),case when is_complete then request_at else null end,request_at)
    on conflict(user_id,video_id) do update set
      watched_seconds=greatest(public.user_video_progress.watched_seconds,excluded.watched_seconds),
      completed_at=case when public.user_video_progress.completed_at is not null
        then public.user_video_progress.completed_at else excluded.completed_at end,
      updated_at=request_at;
  if is_complete then
    insert into public.completion_records(user_id,video_id,method)
      values(uid,s.video_id,'playback') on conflict(user_id,video_id) do nothing;
  end if;
  response:=jsonb_build_object('accepted',true,'duplicate',false,'version',next_version,
    'lastEventSequence',s.last_event_sequence,'acceptedPosition',pos,'percent',pct,
    'complete',is_complete,'durationVerified',v.duration_precision_verified,
    'intervals',(select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,
      'end_seconds',case when v.duration_precision_verified then completion_end_seconds else end_seconds end)
      order by start_seconds),'[]'::jsonb) from public.watched_intervals
      where user_id=uid and video_id=s.video_id and (not v.duration_precision_verified or completion_eligible)),
    'serverIsPlaying',p_is_playing,'budgetSeconds',eligible,'requestAt',request_at,
    'transactionStartedAt',tx_at,'previousHeartbeatAt',s.last_heartbeat_at,
    'previousPosition',s.last_position,'serverElapsed',elapsed,'actualAdvance',delta,
    'requestId',p_request_id);
  update public.playback_sessions set last_position=pos,last_heartbeat_at=request_at,
    is_playing=p_is_playing,active_since=case when p_is_playing then request_at else null end,
    playback_budget_seconds=eligible,
    session_version=next_version,last_accepted_request_id=p_request_id
    where id=s.id;
  insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,
    client_sequence,position,is_playing,kind,accepted,response)
    values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,true,response);
  update public.profiles set last_seen_at=request_at where id=uid;
  return response;
exception when check_violation then
  raise exception 'watched interval constraint failure: session %, prior position %, requested position %, duration %',
    p_session_id,s.last_position,p_position,v.duration_seconds;
end $$;

revoke all on function public.start_playback_session_r11(uuid) from public,anon;
revoke all on function public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon;
grant execute on function public.start_playback_session_r11(uuid) to authenticated;
grant execute on function public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text) to authenticated;

-- Receipt cleanup is permitted only after the corresponding session has
-- exceeded its server-enforced 12-hour lifetime and is inactive.
create or replace function public.cleanup_expired_playback_receipts()
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  update public.playback_sessions set active=false,is_playing=false,active_since=null,
      playback_budget_seconds=0
    where active and started_at<=clock_timestamp()-interval '12 hours';
  delete from public.playback_heartbeat_requests q using public.playback_sessions s
    where q.session_id=s.id and s.started_at<=clock_timestamp()-interval '12 hours'
      and not s.active;
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function public.cleanup_expired_playback_receipts() from public,anon,authenticated;
grant execute on function public.cleanup_expired_playback_receipts() to service_role;

-- Normalize legacy session state. No user progress or completion rows are
-- altered or deleted by this migration.
update public.playback_sessions set is_playing=false,active_since=null,
  playback_budget_seconds=0,
  last_event_sequence=0,session_version=session_version+1
where active;
update public.adp_integrity_release set ready=true,updated_at=clock_timestamp() where singleton;
