CREATE OR REPLACE FUNCTION public.record_playback_heartbeat_r11(p_session_id uuid, p_request_id uuid, p_expected_version bigint, p_client_sequence bigint, p_position numeric, p_is_playing boolean, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
