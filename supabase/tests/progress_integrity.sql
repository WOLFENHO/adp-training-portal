-- Release 1.2 PostgreSQL regression tests. Run only against a disposable local
-- Supabase database with `supabase test db`; the whole test transaction rolls back.
begin;
set local adp.progress_integrity_test='on';
create extension if not exists pgtap with schema extensions;
select extensions.no_plan();

create temporary table adp_test_fixtures(name text primary key,video_id uuid not null default gen_random_uuid(),session_id uuid not null default gen_random_uuid()) on commit drop;
insert into adp_test_fixtures(name) values
 ('continuous'),('paused_burst'),('active_burst'),('pause_resume'),('ordering'),('malformed'),
 ('reposition'),('forward_gap'),('gap_0001'),('gap_001'),('gap_01'),('gap_075'),('full'),
 ('missing_start'),('missing_end'),('delay'),('late'),('buffer'),('rejection'),('preserve'),
 ('expiry'),('duration_match'),('duration_mismatch'),('duration_shorter'),('duration_longer'),('duration_new');
grant select on adp_test_fixtures to authenticated;

do $$
declare uid constant uuid:='a1000000-0000-4000-8000-000000000001';
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values(uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','adp-progress-test@example.invalid','',clock_timestamp(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());
  insert into public.profiles(id,discord_id,username) values(uid,'999999999999999999','ADP progress test');
  insert into public.authorized_discord_ids(discord_id,added_by) values('999999999999999999','local-test');
  insert into public.administrator_roles(discord_id,granted_by) values('999999999999999999','local-test');
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('a2000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','adp-progress-other@example.invalid','',clock_timestamp(),
    '{"provider":"discord","providers":["discord"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());
  insert into public.profiles(id,discord_id,username) values('a2000000-0000-4000-8000-000000000002','999999999999999998','ADP second test user');
  insert into public.authorized_discord_ids(discord_id,added_by) values('999999999999999998','local-test');
  insert into public.videos(id,title,description,duration_seconds,legacy_duration_seconds,duration_precision_verified,published)
    select video_id,'progress test','test fixture',100,100,true,true from adp_test_fixtures;
  update public.adp_playback_control set enabled=true where singleton;
  update public.videos set duration_seconds=300,legacy_duration_seconds=300 where id=(select video_id from adp_test_fixtures where name='continuous');
  update public.videos set duration_precision_verified=false,duration_verified_at=null
    where id in(select video_id from adp_test_fixtures where name in('duration_match','duration_mismatch','duration_shorter','duration_longer','duration_new'));
  insert into public.playback_sessions(id,user_id,video_id,last_position,last_heartbeat_at,started_at,is_playing,active,
    session_version,last_event_sequence,active_since,playback_budget_seconds)
    select session_id,uid,video_id,0,clock_timestamp(),clock_timestamp(),false,true,0,0,null,0 from adp_test_fixtures;
end $$;

create function pg_temp.reset_adp_fixture(fixture_name text,new_position numeric default 0,playing boolean default false,
  elapsed_seconds numeric default 0,budget numeric default 0) returns void language plpgsql security definer set search_path=pg_temp,public as $$
declare v record;
begin
  select * into v from adp_test_fixtures where name=fixture_name;
  delete from public.watched_intervals where video_id=v.video_id;
  delete from public.user_video_progress where video_id=v.video_id;
  delete from public.completion_records where video_id=v.video_id;
  delete from public.playback_heartbeat_requests where session_id=v.session_id;
  update public.playback_sessions set last_position=new_position,last_heartbeat_at=clock_timestamp(),started_at=clock_timestamp(),
    is_playing=playing,active=true,session_version=0,last_event_sequence=0,
    active_since=case when playing then clock_timestamp()-make_interval(secs=>elapsed_seconds::double precision) else null end,
    playback_budget_seconds=budget,last_accepted_request_id=null
    where id=v.session_id;
end $$;

create function pg_temp.seed_adp_intervals(fixture_name text,ranges jsonb,provenance text default 'release_1_2') returns void language plpgsql security definer set search_path=pg_temp,public as $$
begin
  perform set_config('adp.release_1_2_interval_write',case when provenance='release_1_2' then 'verified' else 'legacy' end,true);
  insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds,completion_eligible,completion_end_seconds,verification_source)
  select 'a1000000-0000-4000-8000-000000000001'::uuid,v.video_id,(r->>0)::numeric,(r->>1)::numeric,
    provenance='release_1_2',(r->>1)::numeric,provenance
  from adp_test_fixtures v cross join lateral jsonb_array_elements(ranges) as x(r) where v.name=fixture_name;
  perform set_config('adp.release_1_2_interval_write','',true);
end
$$;
create function pg_temp.freeze_adp_active_clock(fixture_name text) returns void language sql security definer set search_path=pg_temp,public as $$
  update public.playback_sessions s set active_since=clock_timestamp()+interval '1 hour' from adp_test_fixtures f where f.name=fixture_name and s.id=f.session_id
$$;
create function pg_temp.adp_hb(fixture_name text,request_id uuid,expected_version bigint,client_seq bigint,
  position numeric,is_playing boolean,kind text default 'periodic') returns jsonb language sql set search_path=pg_temp,public as $$
  select public.record_playback_heartbeat_r12(v.session_id,request_id,expected_version,client_seq,position,is_playing,kind)
  from adp_test_fixtures v where v.name=fixture_name
$$;

-- Verify reconciliation preserves interval rows: exact legacy duration retains
-- their coverage; a changed duration caps historical coverage one millisecond
-- before the new endpoint and requires fresh endpoint coverage.
select pg_temp.seed_adp_intervals('duration_match','[[0,40],[40,100]]','legacy');
select pg_temp.seed_adp_intervals('duration_mismatch','[[0,50],[50,100]]','legacy');
select pg_temp.seed_adp_intervals('duration_shorter','[[0,100]]','release_1_2');
select pg_temp.seed_adp_intervals('duration_longer','[[0,100]]','release_1_2');
select pg_temp.seed_adp_intervals('duration_new','[[0,100]]','release_1_2');
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='duration_match'),'asset-match','play-match',100);
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='duration_mismatch'),'asset-mismatch','play-mismatch',99);
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='duration_shorter'),'asset-shorter','play-shorter',99);
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='duration_longer'),'asset-longer','play-longer',101);
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='duration_new'),'asset-new','play-new',100);
select is((select count(*) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_match'),2::bigint,'matching duration retains historical interval rows');
select ok((select bool_and(not completion_eligible and verification_source='legacy') from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_match'),'matching Mux duration does not promote unverified legacy intervals');
select is(coalesce((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='duration_match'),0),0::numeric,'legacy coverage contributes no verified progress');
select is((select max(completion_end_seconds) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_mismatch'),null::numeric,'duration reconciliation leaves legacy intervals unverified');
select is((select count(*) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_mismatch'),2::bigint,'mismatched duration reconciliation deletes no intervals');
select is((select max(end_seconds) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_mismatch'),100::numeric,'legacy intervals extending beyond the verified duration remain preserved');
select is((select max(completion_end_seconds) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_shorter'),98.999::numeric,'R1.2 intervals on a shorter verified asset require the endpoint millisecond again');
select is((select max(completion_end_seconds) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_longer'),99.999::numeric,'R1.2 intervals on a longer verified asset cannot cover the old/new boundary by inference');
select is((select max(completion_end_seconds) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='duration_new'),100::numeric,'R1.2 intervals remain eligible when Mux duration matches the legacy duration');
select is((select count(*) from public.verified_completion_records c join adp_test_fixtures f using(video_id) where f.name='duration_match'),0::bigint,'legacy coverage cannot create verified completion');
select throws_ok($$select public.adp_sync_verified_duration('a2220000-0000-4000-8000-000000000002','missing-asset','missing-playback',100)$$,'P0001','video not found','failed duration database update leaves metadata unverified');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

-- Continuous 1x playback uses database elapsed time and persists the full union.
select pg_temp.reset_adp_fixture('continuous',0,true,0,0);
do $$ declare i integer;result jsonb;sid uuid;vid uuid;begin
  select session_id,video_id into sid,vid from adp_test_fixtures where name='continuous';
  for i in 1..24 loop
    perform pg_sleep(8);
    result:=public.record_playback_heartbeat_r12(sid,gen_random_uuid(),i-1,i,i*8,true,'periodic');
    if coalesce((result->>'accepted')::boolean,false) is not true then raise exception '1x heartbeat % rejected: %',i,result;end if;
  end loop;
  if (select count(*) from public.watched_intervals where video_id=vid)<>24 then raise exception 'heartbeat intervals were not persisted';end if;
end $$;
select ok((select session_version=24 and last_position=192 and is_playing from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='continuous'),'continuous playback consumes only server elapsed time and no reserve exists');

-- Paused increments cannot advance by even one stored millisecond. Rejection
-- preserves position, budget, version, intervals and progress; ordering metadata
-- is allowed to advance for this well-formed business rejection.
select pg_temp.reset_adp_fixture('paused_burst',0,false,0,0);
select is((pg_temp.adp_hb('paused_burst','b2000000-0000-4000-8000-000000000001',0,1,0.001,false,'pause')->>'code'),'playback_budget_exceeded','paused advancement has no precision reserve');
select is((pg_temp.adp_hb('paused_burst','b2000000-0000-4000-8000-000000000002',0,2,0.002,false,'pause')->>'code'),'playback_budget_exceeded','new request IDs do not renew an allowance');
select ok((select last_position=0 and playback_budget_seconds=0 and session_version=0 from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='paused_burst'),'rejected requests leave accepted playback state unchanged');
select pg_temp.reset_adp_fixture('active_burst',0,true,0,0); select pg_temp.freeze_adp_active_clock('active_burst');
select is((pg_temp.adp_hb('active_burst','b3000000-0000-4000-8000-000000000001',0,1,0.001,true,'periodic')->>'code'),'playback_budget_exceeded','no reserve is granted during active playback');
select is((pg_temp.adp_hb('active_burst','b3000000-0000-4000-8000-000000000002',0,2,0.002,true,'periodic')->>'code'),'playback_budget_exceeded','rapid active increments cannot renew a tolerance');

-- Accepted pauses and buffering transitions stop the clock. Resume starts a new server window.
select pg_temp.reset_adp_fixture('pause_resume',0,true,5,0);
select is((pg_temp.adp_hb('pause_resume','b4000000-0000-4000-8000-000000000001',0,1,5,false,'pause')->>'accepted')::boolean,true,'pause accepts only previously accrued active time');
select ok((select not is_playing and active_since is null and playback_budget_seconds=0 from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='pause_resume'),'pause clears the active-time window');
select is((pg_temp.adp_hb('pause_resume','b4000000-0000-4000-8000-000000000002',1,2,5,true,'play')->>'accepted')::boolean,true,'resume enters a new active window');
update public.playback_sessions s set active_since=clock_timestamp()-interval '3 seconds' from adp_test_fixtures f where f.name='pause_resume' and s.id=f.session_id;
select is((pg_temp.adp_hb('pause_resume','b4000000-0000-4000-8000-000000000003',2,3,8,false,'pause')->>'accepted')::boolean,true,'resume accrues only the new server-time window');
select pg_temp.reset_adp_fixture('buffer',0,true,3,0);
select is((pg_temp.adp_hb('buffer','bf000000-0000-4000-8000-000000000001',0,1,3,false,'buffering')->>'accepted')::boolean,true,'buffer event stops active accounting');
select is((pg_temp.adp_hb('buffer','bf000000-0000-4000-8000-000000000002',1,2,4,false,'pause')->>'code'),'playback_budget_exceeded','buffered time cannot advance watched position');
select is((pg_temp.adp_hb('buffer','bf000000-0000-4000-8000-000000000003',1,3,3,true,'play')->>'accepted')::boolean,true,'buffer recovery establishes a fresh active window');
update public.playback_sessions s set active_since=clock_timestamp()-interval '2 seconds' from adp_test_fixtures f where f.name='buffer' and s.id=f.session_id;
select is((pg_temp.adp_hb('buffer','bf000000-0000-4000-8000-000000000004',2,4,5,true,'periodic')->>'accepted')::boolean,true,'playback progresses after buffer recovery using only new active time');

-- High-water ordering is independent of expected_version. Delayed older events
-- with fresh versions cannot undo newer transitions; a subsequent event recovers.
select pg_temp.reset_adp_fixture('ordering',0,true,2,0);
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000001',0,1,2,true,'periodic')->>'accepted')::boolean,true,'first event accepted');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000001',0,1,2,true,'periodic')->>'duplicate')::boolean,true,'same request returns its stored result');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000002',1,1,2,false,'pause')->>'code'),'stale_event','delayed pause with current version is stale by event sequence');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000003',1,2,2,false,'pause')->>'accepted')::boolean,true,'newer pause is accepted after stale event');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000004',2,1,2,true,'play')->>'code'),'stale_event','older playing event cannot reactivate a paused session');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000005',2,3,2,true,'play')->>'accepted')::boolean,true,'newer play recovers with authoritative version and sequence');
select is((pg_temp.adp_hb('ordering','b5000000-0000-4000-8000-000000000006',3,2,2,false,'buffering')->>'code'),'stale_event','delayed buffering cannot override newer active playback');
select ok((select is_playing from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='ordering'),'newer active state remains after delayed buffering event');

-- Malformed and malicious sequence inputs do not consume ordering state.
select pg_temp.reset_adp_fixture('malformed',0,false,0,0);
select is((public.record_playback_heartbeat_r12((select session_id from adp_test_fixtures where name='malformed'),gen_random_uuid(),0,1,0,false,'not-an-event')->>'code'),'invalid_request','invalid event type does not consume a sequence');
select is((public.record_playback_heartbeat_r12((select session_id from adp_test_fixtures where name='malformed'),gen_random_uuid(),0,1,0,false,'play')->>'code'),'invalid_event_state','invalid event state does not consume a sequence');
select is((pg_temp.adp_hb('malformed','b5100000-0000-4000-8000-000000000001',0,9007199254740991,0,false,'pause')->>'code'),'sequence_out_of_range','maliciously large sequence is rejected without poisoning high-water');
select is((pg_temp.adp_hb('malformed','b5100000-0000-4000-8000-000000000002',0,1,0,false,'pause')->>'accepted')::boolean,true,'legitimate sequence recovers after rejected large sequence');
select is((select last_event_sequence from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='malformed'),1::bigint,'only a valid in-range event advances high-water');
select set_config('request.jwt.claim.sub','a2000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.record_playback_heartbeat_r12((select session_id from adp_test_fixtures where name='malformed'),'b5200000-0000-4000-8000-000000000001',1,2,0,false,'pause')$$,'P0001','session_invalid','another authorized member cannot consume this session sequence');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select is((select last_event_sequence from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='malformed'),1::bigint,'wrong-owner request leaves ordering high-water unchanged');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='playback_sessions' and column_name='precision_reserve_seconds'),'no per-session precision allowance exists to renew');

-- Receipts remain idempotent beyond the former 511-row pruning boundary.
select pg_temp.reset_adp_fixture('delay',0,false,0,0);
do $$ declare i integer;sid uuid;req uuid:='be000000-0000-4000-8000-000000000001';r jsonb;begin
  select session_id into sid from adp_test_fixtures where name='delay';
  r:=public.record_playback_heartbeat_r12(sid,req,0,1,0,false,'pause');
  for i in 2..520 loop r:=public.record_playback_heartbeat_r12(sid,gen_random_uuid(),i-1,i,0,false,'pause');end loop;
  r:=public.record_playback_heartbeat_r12(sid,req,0,1,0,false,'pause');
  if r->>'duplicate'<>'true' or r->>'version'<>'1' then raise exception 'old retry did not preserve original result: %',r;end if;
end $$;
select ok((select count(*)>=520 from public.playback_heartbeat_requests q join adp_test_fixtures f on f.session_id=q.session_id where f.name='delay'),'active-session receipts are not pruned');

-- Watched interval repositioning and gaps.
select pg_temp.reset_adp_fixture('reposition',10,false,0,0); select pg_temp.seed_adp_intervals('reposition','[[0,10]]');
select is((pg_temp.adp_hb('reposition','b6000000-0000-4000-8000-000000000001',0,1,5,false,'seek')->>'accepted')::boolean,true,'backward reposition inside verified coverage works');
select is((pg_temp.adp_hb('reposition','b6000000-0000-4000-8000-000000000002',1,2,10,false,'seek')->>'accepted')::boolean,true,'forward reposition within fully watched coverage works');
select is((select count(*) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='reposition'),1::bigint,'reposition does not add coverage');
select pg_temp.reset_adp_fixture('forward_gap',5,false,0,0);select pg_temp.seed_adp_intervals('forward_gap','[[0,5],[10,20]]');
select is((pg_temp.adp_hb('forward_gap','b7000000-0000-4000-8000-000000000001',0,1,20,false,'seek')->>'code'),'unwatched_forward_seek','forward seek across a gap is rejected');

-- Completion requires exact full coverage with no positive gaps or missing ends.
select pg_temp.reset_adp_fixture('gap_0001',100,false,0,0);select pg_temp.seed_adp_intervals('gap_0001','[[0,50],[50.001,100]]');
select is((pg_temp.adp_hb('gap_0001','b8100000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,false,'representable 0.001 second gap is not hidden by boundary precision');
select pg_temp.reset_adp_fixture('gap_001',100,false,0,0);select pg_temp.seed_adp_intervals('gap_001','[[0,50],[50.01,100]]');
select is((pg_temp.adp_hb('gap_001','b8000000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,false,'0.01 second gap prevents completion');
select pg_temp.reset_adp_fixture('gap_01',100,false,0,0);select pg_temp.seed_adp_intervals('gap_01','[[0,50],[50.1,100]]');
select is((pg_temp.adp_hb('gap_01','b9000000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,false,'0.1 second gap prevents completion');
select pg_temp.reset_adp_fixture('gap_075',100,false,0,0);select pg_temp.seed_adp_intervals('gap_075','[[0,50],[50.75,100]]');
select is((pg_temp.adp_hb('gap_075','ba000000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,false,'0.75 second gap prevents completion');
select pg_temp.reset_adp_fixture('full',100,false,0,0);select pg_temp.seed_adp_intervals('full','[[0,100]]');
insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at)
  select 'a1000000-0000-4000-8000-000000000001',video_id,100,'2026-01-01T00:00:00Z' from adp_test_fixtures where name='full';
insert into public.completion_records(user_id,video_id,completed_at,method)
  select 'a1000000-0000-4000-8000-000000000001',video_id,'2026-01-01T00:00:00Z','admin_override' from adp_test_fixtures where name='full';
select is((pg_temp.adp_hb('full','bb000000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,true,'exact full coverage completes');
select is((pg_temp.adp_hb('full','bb000000-0000-4000-8000-000000000002',1,2,100,false,'complete')->>'complete')::boolean,true,'completion remains idempotent on later heartbeat');
select is((select count(*) from public.verified_completion_records c join adp_test_fixtures f using(video_id) where f.name='full'),1::bigint,'verified completion is stored in its separate table once');
select is((select count(*) from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='full'),1::bigint,'verified completion does not add a duplicate to historical completion records');
select is((select completed_at::date from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='full'),'2026-01-01'::date,'historical progress completion date remains unchanged after verified completion');
select is((select completed_at::date from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='full'),'2026-01-01'::date,'historical completion record remains intact after verified completion');
select pg_temp.reset_adp_fixture('missing_start',100,false,0,0);select pg_temp.seed_adp_intervals('missing_start','[[0.001,100]]');
select is((pg_temp.adp_hb('missing_start','bc000000-0000-4000-8000-000000000001',0,1,100,false,'complete')->>'complete')::boolean,false,'missing beginning prevents completion');
select pg_temp.reset_adp_fixture('missing_end',99.999,false,0,0);select pg_temp.seed_adp_intervals('missing_end','[[0,99.999]]');
select is((pg_temp.adp_hb('missing_end','bd000000-0000-4000-8000-000000000001',0,1,99.999,false,'complete')->>'complete')::boolean,false,'missing ending prevents completion');

-- Rejected heartbeats preserve all progress-bearing state.
select pg_temp.reset_adp_fixture('late',0,true,45,0);
select is((pg_temp.adp_hb('late','be100000-0000-4000-8000-000000000001',0,1,45,true,'periodic')->>'accepted')::boolean,true,'delayed heartbeat uses only accumulated database active time');
select pg_temp.reset_adp_fixture('rejection',5,true,1,0);select pg_temp.seed_adp_intervals('rejection','[[0,5]]');
insert into public.user_video_progress(user_id,video_id,watched_seconds) select 'a1000000-0000-4000-8000-000000000001',video_id,5 from adp_test_fixtures where name='rejection';
select is((pg_temp.adp_hb('rejection','c0000000-0000-4000-8000-000000000001',0,1,10,true,'periodic')->>'code'),'playback_budget_exceeded','too-fast heartbeat is rejected');
select ok((select session_version=0 and playback_budget_seconds=0 and last_position=5 from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='rejection'),'rejection leaves session budget position and version unchanged');
select is((select count(*) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='rejection'),1::bigint,'rejection leaves intervals unchanged');
select is((select watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='rejection'),5::numeric,'rejection leaves progress unchanged');

-- Database timestamps enforce the boundary. Accepted request before expiry is
-- durable; its retry after expiry returns the original result. New requests at
-- expiry are rejected and receipt retries repeat that rejection.
select pg_temp.reset_adp_fixture('expiry',0,false,0,0);
update public.playback_sessions s set started_at=clock_timestamp()-interval '12 hours'+interval '2 seconds' from adp_test_fixtures f where f.name='expiry' and s.id=f.session_id;
select is((pg_temp.adp_hb('expiry','c2000000-0000-4000-8000-000000000001',0,1,0,false,'pause')->>'accepted')::boolean,true,'heartbeat just before expiry is accepted');
update public.playback_sessions s set started_at=clock_timestamp()-interval '12 hours'-interval '1 millisecond' from adp_test_fixtures f where f.name='expiry' and s.id=f.session_id;
select is((pg_temp.adp_hb('expiry','c2000000-0000-4000-8000-000000000001',0,1,0,false,'pause')->>'duplicate')::boolean,true,'accepted retry after expiry returns original receipt');
select is((pg_temp.adp_hb('expiry','c2000000-0000-4000-8000-000000000002',1,2,0,false,'pause')->>'code'),'session_expired','new heartbeat after expiry is rejected');
select is((pg_temp.adp_hb('expiry','c2000000-0000-4000-8000-000000000002',1,2,0,false,'pause')->>'duplicate')::boolean,true,'expiry rejection retry is idempotent');
select ok((select not active and not is_playing and active_since is null from public.playback_sessions s join adp_test_fixtures f using(session_id) where f.name='expiry'),'expired session cannot reactivate');
set local role service_role;
select is(public.cleanup_expired_playback_receipts(),2,'receipt cleanup removes rows only after session expiry');
set local role authenticated;
select is((pg_temp.adp_hb('expiry','c2000000-0000-4000-8000-000000000002',1,2,0,false,'pause')->>'code'),'session_expired','post-expiry retry remains rejected after the supported idempotency lifetime');

-- Existing completion/progress values are not overwritten by heartbeat updates.
select pg_temp.reset_adp_fixture('preserve',5,false,0,0);select pg_temp.seed_adp_intervals('preserve','[[0,5]]');
insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at) select 'a1000000-0000-4000-8000-000000000001',video_id,5,'2026-01-01T00:00:00Z' from adp_test_fixtures where name='preserve';
insert into public.completion_records(user_id,video_id,completed_at,method) select 'a1000000-0000-4000-8000-000000000001',video_id,'2026-01-01T00:00:00Z','admin_override' from adp_test_fixtures where name='preserve';
select is((pg_temp.adp_hb('preserve','c1000000-0000-4000-8000-000000000001',0,1,5,false,'complete')->>'accepted')::boolean,true,'existing progress supports normal heartbeat');
select is((select method from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='preserve'),'admin_override','existing completion method is preserved');
select is((select completed_at::date from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='preserve'),'2026-01-01'::date,'existing completion timestamp is preserved');

select * from extensions.finish();
rollback;

