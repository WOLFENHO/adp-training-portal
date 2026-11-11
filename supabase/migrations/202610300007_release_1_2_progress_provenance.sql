-- Release 1.2: distinguish historical interval/completion data from progress
-- written through the verified Release 1.2 heartbeat path.
-- Apply only after migrations 005 and 006, with playback disabled.
set local lock_timeout = '5s';

alter table public.watched_intervals
  add column if not exists verification_source text not null default 'legacy';
alter table public.watched_intervals
  add constraint watched_intervals_verification_source_check
  check (verification_source in ('legacy','release_1_2'));
alter table public.user_video_progress
  add column if not exists verified_watched_seconds numeric(12,3) not null default 0;

create table if not exists public.verified_completion_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  asset_id text not null,
  duration_seconds numeric(12,3) not null check(duration_seconds>0),
  completed_at timestamptz not null default clock_timestamp(),
  validator_version smallint not null default 12 check(validator_version=12),
  primary key(user_id,video_id,asset_id,duration_seconds)
);
alter table public.verified_completion_records enable row level security;
revoke all on public.verified_completion_records from public,anon;
create policy verified_completion_read on public.verified_completion_records
  for select to authenticated using(user_id=auth.uid() or public.is_administrator());
grant select on public.verified_completion_records to authenticated;

create table if not exists public.adp_playback_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.adp_playback_control enable row level security;
revoke all on public.adp_playback_control from public,anon,authenticated;
insert into public.adp_playback_control(singleton,enabled,updated_at)
  values(true,false,clock_timestamp())
  on conflict(singleton) do update set enabled=false,updated_at=excluded.updated_at;

-- All intervals that predate this migration are legacy, including Release 1.1
-- intervals: 001-006 provide no provenance proving they used the stricter
-- Release 1.2 rules. Preserve the rows, but never count them for verified work.
update public.watched_intervals
set verification_source='legacy',completion_eligible=false,completion_end_seconds=null
where verification_source is distinct from 'legacy'
   or completion_eligible
   or completion_end_seconds is not null;

update public.adp_integrity_release set version=12,ready=false,updated_at=clock_timestamp()
where singleton;

create or replace function public.adp_mark_interval_provenance_r12()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare verified boolean; dur numeric;
begin
  if current_setting('adp.release_1_2_interval_write',true)='verified' then
    select duration_precision_verified,duration_seconds into verified,dur
      from public.videos where id=new.video_id;
    new.verification_source:='release_1_2';
    new.completion_eligible:=coalesce(verified,false);
    new.completion_end_seconds:=case when coalesce(verified,false)
      then least(new.end_seconds,dur) else null end;
  else
    new.verification_source:='legacy';
    new.completion_eligible:=false;
    new.completion_end_seconds:=null;
  end if;
  return new;
end $$;
drop trigger if exists watched_intervals_mark_provenance_r12 on public.watched_intervals;
create trigger watched_intervals_mark_provenance_r12
  before insert on public.watched_intervals
  for each row execute function public.adp_mark_interval_provenance_r12();
revoke all on function public.adp_mark_interval_provenance_r12() from public,anon,authenticated;

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
      and verification_source='release_1_2'
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
    insert into public.verified_completion_records(user_id,video_id,asset_id,duration_seconds,completed_at)
      values(p_user_id,p_video_id,v.asset_id,v.duration_seconds,completed_at_value)
      on conflict(user_id,video_id,asset_id,duration_seconds) do nothing;
    -- Verified completion has its own versioned table above. Do not write it
    -- into completion_records: that table is historical provenance only.
  end if;
  return jsonb_build_object('verifiedWatchedSeconds',covered,'verifiedComplete',is_complete,
    'durationVerified',v.duration_precision_verified,'assetId',v.asset_id,
    'durationSeconds',v.duration_seconds);
end $$;
revoke all on function public.adp_refresh_verified_progress_r12(uuid,uuid) from public,anon,authenticated;

create or replace function public.adp_sync_verified_duration(
  p_video_id uuid,p_asset_id text,p_playback_id text,p_duration numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  old_duration numeric;
  verified_duration numeric;
  matching boolean;
  completion_cap numeric;
  changed integer;
  verified_at timestamptz:=clock_timestamp();
  uid uuid;
  refresh_result jsonb;
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

  -- Reconcile only intervals created by the Release 1.2 wrapper. Legacy rows
  -- remain intact and ineligible regardless of plausible timestamps/duration.
  completion_cap:=case when matching then verified_duration
      else greatest(0,least(coalesce(old_duration,0),verified_duration)-0.001) end;
  update public.watched_intervals set
      completion_eligible=(start_seconds<completion_cap and end_seconds>start_seconds),
      completion_end_seconds=case when start_seconds<completion_cap
        then least(end_seconds,completion_cap) else null end
    where video_id=p_video_id and verification_source='release_1_2';
  get diagnostics changed=row_count;
  for uid in select distinct user_id from public.watched_intervals
    where video_id=p_video_id and verification_source='release_1_2'
  loop
    refresh_result:=public.adp_refresh_verified_progress_r12(uid,p_video_id);
  end loop;
  return jsonb_build_object('ok',true,'duration',verified_duration,
      'legacyDuration',old_duration,'durationMatched',matching,
      'release12IntervalRowsReconciled',changed,'durationVerifiedAt',verified_at);
end $$;
revoke all on function public.adp_sync_verified_duration(uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.adp_sync_verified_duration(uuid,text,text,numeric) to service_role;

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
    where user_id=uid and video_id=p_video_id and verification_source='release_1_2'
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
      last_event_sequence,playback_budget_seconds,is_playing,active_since)
    values(uid,p_video_id,pos,0,0,0,false,null)
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
  select * into v from public.videos where id=s.video_id;
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
        and verification_source='release_1_2'
        and (not v.duration_precision_verified or completion_eligible);
    result:=result||jsonb_build_object('percent',confirmed_percent,'verifiedWatchedSeconds',
      (refreshed->>'verifiedWatchedSeconds')::numeric,
      'complete',coalesce((refreshed->>'verifiedComplete')::boolean,false),
      'intervals',coalesce(intervals,'[]'::jsonb),'durationVerified',v.duration_precision_verified);
  end if;
  return result;
end $$;

-- Old RPCs remain fail-closed. R11 is callable internally by this security-
-- definer wrapper only; members use the versioned R12 endpoints.
-- Remove inherited/default direct grants from every non-owner role on the new
-- entry points before granting the one intended client role. This also covers
-- project-specific ALTER DEFAULT PRIVILEGES entries.
do $$
declare
  signature text;
  target regprocedure;
  grantee record;
  signatures text[]:=array[
    'public.start_playback_session_r12(uuid)',
    'public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)'
  ];
begin
  foreach signature in array signatures loop
    target:=to_regprocedure(signature);
    for grantee in
      select distinct a.grantee
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=target and a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    loop
      if grantee.grantee=0 then
        execute format('revoke all on function %s from public cascade',target);
      else
        execute format('revoke all on function %s from %I cascade',target,pg_get_userbyid(grantee.grantee));
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.start_playback_session(uuid) from public,anon,authenticated;
revoke all on function public.record_playback_heartbeat(uuid,numeric,boolean) from public,anon,authenticated;
revoke all on function public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon,authenticated;
revoke all on function public.start_playback_session_r11(uuid) from public,anon,authenticated;
revoke all on function public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon,authenticated;
revoke all on function public.start_playback_session_r12(uuid) from public,anon;
revoke all on function public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text) from public,anon;
grant execute on function public.start_playback_session_r12(uuid) to authenticated;
grant execute on function public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text) to authenticated;

update public.adp_integrity_release set version=12,ready=true,updated_at=clock_timestamp()
where singleton;
