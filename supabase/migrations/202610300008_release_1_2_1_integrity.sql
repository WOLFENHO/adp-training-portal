-- Release 1.2.1. Explicit atomic migration; keep all application traffic disabled.
begin;
set local lock_timeout='5s';
-- SECURITY DEFINER functions require a schema that untrusted roles cannot write.
do $$begin
 if has_schema_privilege('authenticated','public','CREATE') or has_schema_privilege('anon','public','CREATE') then
 raise exception 'Untrusted CREATE privilege on public schema: review ACLs before migration'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('start_playback_session_r12','record_playback_heartbeat_r12','record_playback_heartbeat_r11','adp_refresh_verified_progress_r12','adp_sync_verified_duration')
 and (pg_has_role('authenticated',p.proowner,'MEMBER') or pg_has_role('anon',p.proowner,'MEMBER'))) then
 raise exception 'Untrusted ownership of playback SECURITY DEFINER functions';end if;
end$$;
alter table public.watched_intervals add column asset_identity text, add column reset_at timestamptz;
alter table public.playback_sessions add column asset_identity text;
alter table public.verified_completion_records add column reset_at timestamptz, add column asset_identity text, add column verified_at timestamptz;
create function public.adp_asset_identity(v public.videos) returns text language sql immutable as $$
 select case when v.asset_id is not null and v.duration_precision_verified then v.asset_id || ':' || v.duration_seconds::text || ':12' end
$$;
-- Unbound historical evidence is preserved and never backfilled into a version.
update public.playback_sessions set active=false,is_playing=false,active_since=null,playback_budget_seconds=0;
update public.user_video_progress set verified_watched_seconds=0;
create function public.adp_guard_interval_update() returns trigger language plpgsql as $$
begin
 if row(new.user_id,new.video_id,new.verification_source,new.asset_identity,new.start_seconds,new.end_seconds,new.completion_eligible,new.completion_end_seconds)
 is distinct from row(old.user_id,old.video_id,old.verification_source,old.asset_identity,old.start_seconds,old.end_seconds,old.completion_eligible,old.completion_end_seconds) then raise exception 'immutable interval evidence'; end if;
 return new;
end $$;
create trigger interval_evidence_immutable before update on public.watched_intervals for each row execute function public.adp_guard_interval_update();
create or replace function public.adp_mark_interval_provenance_r12()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare verified boolean; dur numeric;
begin
  if current_setting('adp.release_1_2_interval_write',true)='verified' then
    select duration_precision_verified,duration_seconds into verified,dur
      from public.videos where id=new.video_id;
    new.verification_source:='release_1_2';
    select public.adp_asset_identity(v) into new.asset_identity from public.videos v where id=new.video_id;
    new.completion_eligible:=coalesce(verified,false);
    new.completion_end_seconds:=case when coalesce(verified,false)
      then least(new.end_seconds,dur) else null end;
  else
    new.asset_identity:=null;
    new.verification_source:='legacy';
    new.completion_eligible:=false;
    new.completion_end_seconds:=null;
  end if;
  return new;
end $$;
create or replace function public.adp_refresh_verified_progress_r12(p_user_id uuid,p_video_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v public.videos%rowtype;
  r record;
  run_start numeric;
  run_end numeric;
  covered numeric:=0;
  is_complete boolean:=false;
  completed_at_value timestamptz:=clock_timestamp();
begin
  select * into v from public.videos where id=p_video_id;
  if not found then raise exception 'video not found'; end if;
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
      if run_start=0 and run_end>=v.duration_seconds then is_complete:=true; end if;
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then
    covered:=covered+(run_end-run_start);
    if run_start=0 and run_end>=v.duration_seconds then is_complete:=true; end if;
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
end $$;
create or replace function public.start_playback_session_r12(p_video_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid(); v public.videos%rowtype; r record;
  pos numeric:=0; run_end numeric:=0; sid uuid; expires_at timestamptz;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.adp_playback_control where singleton and enabled) then
    raise exception using errcode='P0001',message='playback_maintenance';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_video_id::text,0));
  select * into v from public.videos where id=p_video_id and published for share;
  if not found or v.duration_seconds<=0 then raise exception 'video unavailable'; end if;
  for r in select start_seconds,
    case when v.duration_precision_verified then completion_end_seconds else end_seconds end as end_seconds
    from public.watched_intervals
    where user_id=uid and video_id=p_video_id and verification_source='release_1_2' and reset_at is null and asset_identity=public.adp_asset_identity(v)
      and (not v.duration_precision_verified or completion_eligible)
      and (case when v.duration_precision_verified then completion_end_seconds else end_seconds end)>start_seconds
    order by start_seconds,end_seconds
  loop
    if r.start_seconds>run_end then exit; end if;
    run_end:=greatest(run_end,r.end_seconds);
  end loop;
  pos:=least(run_end,v.duration_seconds);
  update public.playback_sessions set active=false,is_playing=false,active_since=null,
      playback_budget_seconds=0 where user_id=uid and video_id=p_video_id and active;
  insert into public.playback_sessions(user_id,video_id,last_position,session_version,
      last_event_sequence,playback_budget_seconds,is_playing,active_since,asset_identity)
    values(uid,p_video_id,pos,0,0,0,false,null,public.adp_asset_identity(v))
    returning id,started_at+interval '12 hours' into sid,expires_at;
  update public.profiles set last_seen_at=clock_timestamp() where id=uid;
  return jsonb_build_object('sessionId',sid,'position',pos,'version',0,'lastEventSequence',0,
    'isPlaying',false,'durationVerified',v.duration_precision_verified,'sessionExpiresAt',expires_at);
end $$;
create or replace function public.record_playback_heartbeat_r12(
  p_session_id uuid,p_request_id uuid,p_expected_version bigint,
  p_client_sequence bigint,p_position numeric,p_is_playing boolean,p_kind text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid(); s public.playback_sessions%rowtype;
  old_completed_at timestamptz;
  existed boolean; had_completion_record boolean; call_started_at timestamptz:=clock_timestamp();
  result jsonb; refreshed jsonb; v public.videos%rowtype;
  confirmed_percent numeric:=0;
  intervals jsonb;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  if not exists(select 1 from public.adp_playback_control where singleton and enabled) then
    return jsonb_build_object('accepted',false,'code','playback_maintenance',
      'error','Verified playback is temporarily disabled.');
  end if;
  -- Lock and authenticate ownership before setting provenance context or
  -- calling the Release 1.1 validator. That validator retains all budget,
  -- sequence, expiry, request-receipt, and interval checks.
  select * into s from public.playback_sessions where id=p_session_id and user_id=uid for update;
  if not found then raise exception using errcode='P0001',message='session_invalid'; end if;
  if exists(select 1 from public.playback_heartbeat_requests where session_id=s.id and request_id=p_request_id) then
    return public.record_playback_heartbeat_r11(p_session_id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind);
  end if;
  select * into v from public.videos where id=s.video_id for share;
  if s.asset_identity is distinct from public.adp_asset_identity(v) then
    -- Invalid shapes never create receipts or alter session state.
    if p_request_id is null or p_expected_version is null or p_expected_version<0 or
       p_client_sequence is null or p_client_sequence<1 or p_position is null or p_position<0 or
       p_is_playing is null or p_kind is null or p_kind not in ('play','pause','buffering','periodic','seek','complete') then
      return jsonb_build_object('accepted',false,'code','invalid_request');
    end if;
    -- Permanently retire the mismatched session; never promote its position.
    -- This invalid-session transition preserves stored budget and evidence.
    update public.playback_sessions set active=false,is_playing=false,active_since=null where id=s.id;
    result:=jsonb_build_object('accepted',false,'code','asset_version_changed',
      'error','Video version changed. Reopen the lesson.','version',s.session_version,
      'lastEventSequence',s.last_event_sequence,'acceptedPosition',s.last_position,'serverIsPlaying',false);
    insert into public.playback_heartbeat_requests(session_id,request_id,expected_version,client_sequence,position,is_playing,kind,accepted,response)
      values(s.id,p_request_id,p_expected_version,p_client_sequence,p_position,p_is_playing,p_kind,false,result);
    return result;
  end if;
  select completed_at into old_completed_at from public.user_video_progress
    where user_id=uid and video_id=s.video_id;
  existed:=found;
  select exists(select 1 from public.completion_records
    where user_id=uid and video_id=s.video_id) into had_completion_record;
  perform set_config('adp.release_1_2_interval_write','verified',true);
  result:=public.record_playback_heartbeat_r11(p_session_id,p_request_id,p_expected_version,
    p_client_sequence,p_position,p_is_playing,p_kind);
  if coalesce((result->>'accepted')::boolean,false) then
    refreshed:=public.adp_refresh_verified_progress_r12(uid,s.video_id);
    -- The old field remains a historical completion timestamp. Release 1.2
    -- completion dates live only in verified_completion_records.
    if not existed then
      update public.user_video_progress set completed_at=null where user_id=uid and video_id=s.video_id;
    else
      update public.user_video_progress set completed_at=old_completed_at where user_id=uid and video_id=s.video_id;
    end if;
    if not had_completion_record then
      -- R11 wrote its legacy-format receipt while computing coverage. Keep the
      -- new proof only in verified_completion_records, not in the historical table.
      delete from public.completion_records where user_id=uid and video_id=s.video_id
        and method='playback' and completed_at>=call_started_at;
    end if;
    confirmed_percent:=least(100,round(coalesce((refreshed->>'verifiedWatchedSeconds')::numeric,0)
      /greatest(v.duration_seconds,1)*100,1));
    select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,
      'end_seconds',case when v.duration_precision_verified then completion_end_seconds else end_seconds end)
      order by start_seconds),'[]'::jsonb) into intervals
      from public.watched_intervals where user_id=uid and video_id=s.video_id
        and verification_source='release_1_2' and reset_at is null and asset_identity=public.adp_asset_identity(v)
        and (not v.duration_precision_verified or completion_eligible);
    result:=result||jsonb_build_object('percent',confirmed_percent,'verifiedWatchedSeconds',
      (refreshed->>'verifiedWatchedSeconds')::numeric,
      'complete',coalesce((refreshed->>'verifiedComplete')::boolean,false),
      'intervals',coalesce(intervals,'[]'::jsonb),'durationVerified',v.duration_precision_verified);
    update public.playback_heartbeat_requests set response=result where session_id=s.id and request_id=p_request_id;
  end if;
  return result;
end $$;
create or replace function public.record_playback_heartbeat_r11(
  p_session_id uuid,p_request_id uuid,p_expected_version bigint,
  p_client_sequence bigint,p_position numeric,p_is_playing boolean,p_kind text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
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
          'currentServerIsPlaying',s.is_playing,'currentAcceptedPosition',s.last_position,'currentSessionActive',s.active);
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
    where user_id=uid and video_id=s.video_id and reset_at is null and verification_source='release_1_2' and asset_identity=public.adp_asset_identity(v) and start_seconds<=pos and
      (case when v.duration_precision_verified then completion_eligible and completion_end_seconds>=pos
        else end_seconds>=pos end));

  if delta>0 and target_covered then
    cursor_at:=s.last_position;
    for r in select start_seconds,
      case when v.duration_precision_verified then completion_end_seconds else end_seconds end as end_seconds
      from public.watched_intervals where user_id=uid and video_id=s.video_id and reset_at is null and verification_source='release_1_2' and asset_identity=public.adp_asset_identity(v)
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
    where user_id=uid and video_id=s.video_id and reset_at is null and verification_source='release_1_2' and asset_identity=public.adp_asset_identity(v) order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end then run_end:=greatest(run_end,r.end_seconds);
    else display_total:=display_total+(run_end-run_start);run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then display_total:=display_total+(run_end-run_start); end if;
  run_start:=null;run_end:=null;
  for r in select start_seconds,completion_end_seconds from public.watched_intervals
    where user_id=uid and video_id=s.video_id and reset_at is null and verification_source='release_1_2' and asset_identity=public.adp_asset_identity(v) and completion_eligible
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
    values(uid,s.video_id,greatest(total,display_total),null,request_at)
    on conflict(user_id,video_id) do update set
      watched_seconds=greatest(public.user_video_progress.watched_seconds,excluded.watched_seconds),
      completed_at=case when public.user_video_progress.completed_at is not null
        then public.user_video_progress.completed_at else excluded.completed_at end,
      updated_at=request_at;
  -- Historical completion tables are never populated by this validator.
  response:=jsonb_build_object('accepted',true,'duplicate',false,'version',next_version,
    'lastEventSequence',s.last_event_sequence,'acceptedPosition',pos,'percent',pct,
    'complete',is_complete,'durationVerified',v.duration_precision_verified,
    'intervals',(select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,
      'end_seconds',case when v.duration_precision_verified then completion_end_seconds else end_seconds end)
      order by start_seconds),'[]'::jsonb) from public.watched_intervals
      where user_id=uid and video_id=s.video_id and reset_at is null and verification_source='release_1_2' and asset_identity=public.adp_asset_identity(v) and (not v.duration_precision_verified or completion_eligible)),
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
create or replace function public.adp_sync_verified_duration(p_video_id uuid,p_asset_id text,p_playback_id text,p_duration numeric) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.videos%rowtype; u uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'not authorized'; end if;
 if not exists(select 1 from public.adp_playback_control where singleton and enabled) then raise exception 'maintenance'; end if;
 if p_asset_id is null or p_playback_id is null or p_duration is null or round(p_duration,3)<=0 or p_duration>999999999 then raise exception 'invalid duration'; end if;
 select * into v from public.videos where id=p_video_id for update;
 if not found then raise exception 'video not found'; end if;
 update public.videos set asset_id=p_asset_id,playback_id=p_playback_id,duration_seconds=round(p_duration,3),duration_precision_verified=true,duration_verified_at=clock_timestamp() where id=p_video_id;
 for u in select user_id from public.user_video_progress where video_id=p_video_id loop perform public.adp_refresh_verified_progress_r12(u,p_video_id); end loop;
 insert into public.admin_audit_log(action,details) values('duration-sync',jsonb_build_object('videoId',p_video_id,'previousAsset',v.asset_id,'assetId',p_asset_id,'duration',round(p_duration,3)));
 return jsonb_build_object('ok',true,'duration',round(p_duration,3));
end $$;
create function public.adp_admin_progress(p_user_id uuid,p_video_id uuid,p_action text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not public.is_authorized() or not public.is_administrator() then raise exception 'not authorized'; end if;
 if not exists(select 1 from public.adp_playback_control where enabled and singleton) then raise exception 'maintenance'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_video_id::text,0));
 perform 1 from public.playback_sessions where user_id=p_user_id and video_id=p_video_id order by id for update;
 if p_action='progress-reset' then
 update public.playback_sessions set active=false,is_playing=false,active_since=null,playback_budget_seconds=0,session_version=session_version+1 where user_id=p_user_id and video_id=p_video_id;
 update public.watched_intervals set reset_at=clock_timestamp() where user_id=p_user_id and video_id=p_video_id and reset_at is null;
 update public.verified_completion_records set reset_at=clock_timestamp() where user_id=p_user_id and video_id=p_video_id and reset_at is null;
 update public.user_video_progress set verified_watched_seconds=0 where user_id=p_user_id and video_id=p_video_id;
 elsif p_action='progress-complete' then
 insert into public.completion_records(user_id,video_id,method,admin_id) values(p_user_id,p_video_id,'admin_override',actor) on conflict do nothing;
 else raise exception 'invalid action'; end if;
 insert into public.admin_audit_log(admin_id,action,details) values(actor,p_action,jsonb_build_object('userId',p_user_id,'videoId',p_video_id));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.adp_admin_progress(uuid,uuid,text) from public,anon;
grant execute on function public.adp_admin_progress(uuid,uuid,text) to authenticated;
-- Internal validators must not inherit custom EXECUTE defaults.
do $$declare signature text;target regprocedure;g record;begin
 foreach signature in array array['public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text)','public.adp_refresh_verified_progress_r12(uuid,uuid)'] loop
 target:=to_regprocedure(signature);
 for g in select distinct a.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=target and a.privilege_type='EXECUTE' and a.grantee<>p.proowner loop
 if g.grantee=0 then execute format('revoke execute on function %s from public cascade',target);
 else execute format('revoke execute on function %s from %I cascade',target,pg_get_userbyid(g.grantee));end if;
 end loop;
 end loop;
end$$;
-- Effective grants are intentionally restricted; function owners remain trusted.
revoke all on public.watched_intervals,public.verified_completion_records from anon,authenticated;
grant select on public.watched_intervals,public.verified_completion_records to authenticated;
revoke all on function public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text),
 public.adp_refresh_verified_progress_r12(uuid,uuid),public.adp_guard_interval_update() from public,anon,authenticated;
create or replace function public.adp_playback_integrity_version() returns integer language sql stable security definer set search_path=public,pg_temp as $$
 select r.version from public.adp_integrity_release r join public.adp_playback_control c using(singleton)
 where r.singleton and r.ready and c.enabled
$$;
update public.adp_playback_control set enabled=false;
update public.adp_integrity_release set version=121,ready=true;
commit;
