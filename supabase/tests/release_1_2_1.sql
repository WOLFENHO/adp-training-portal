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
  update public.videos set asset_id='fixture-'||id::text where id in(select video_id from adp_test_fixtures);
  update public.adp_playback_control set enabled=true where singleton;
  update public.videos set duration_seconds=300,legacy_duration_seconds=300 where id=(select video_id from adp_test_fixtures where name='continuous');
  update public.videos set duration_precision_verified=false,duration_verified_at=null
    where id in(select video_id from adp_test_fixtures where name in('duration_match','duration_mismatch','duration_shorter','duration_longer','duration_new'));
  insert into public.playback_sessions(id,user_id,video_id,last_position,last_heartbeat_at,started_at,is_playing,active,
    session_version,last_event_sequence,active_since,playback_budget_seconds,asset_identity)
    select session_id,uid,video_id,0,clock_timestamp(),clock_timestamp(),false,true,0,0,null,0,public.adp_asset_identity(v) from adp_test_fixtures f join public.videos v on v.id=f.video_id;
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
  media_position numeric,is_playing boolean,kind text default 'periodic') returns jsonb language sql set search_path=pg_temp,public as $$
  select public.record_playback_heartbeat_r12(v.session_id,request_id,expected_version,client_seq,media_position,is_playing,kind)
  from adp_test_fixtures v where v.name=fixture_name
$$;


select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
-- Verified evidence is earned by the real validator; only the clock fixture is privileged.
select pg_temp.reset_adp_fixture('full',0,true,101,0);
select ok((pg_temp.adp_hb('full',gen_random_uuid(),0,1,100,false,'complete')->>'complete')::boolean,'actual validator records full completion');
select is((select count(*) from public.completion_records),0::bigint,'new validator never manufactures historical completion records');
create temporary table original_completion as select * from public.verified_completion_records;
select set_config('request.jwt.claim.role','service_role',true);
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='full'),'replacement-same-duration','replacement-playback',100);
select is((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='full'),0::numeric,'same-duration replacement has zero verified coverage');
select is((select count(*) from public.verified_completion_records where asset_id='replacement-same-duration'),0::bigint,'replacement cannot manufacture completion');
select is(pg_temp.adp_hb('full','de000000-0000-4000-8000-000000000001',1,2,100,false,'complete')->>'code','asset_version_changed','old session cannot act on replacement asset');
select ok((pg_temp.adp_hb('full','de000000-0000-4000-8000-000000000001',1,2,100,false,'complete')->>'duplicate')::boolean,'asset mismatch rejection is receipt-backed');
select is((select count(*) from original_completion o join public.verified_completion_records c using(user_id,video_id,asset_id,duration_seconds) where o.completed_at=c.completed_at),1::bigint,'original completion date survives replacement');
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='full'),'replacement-same-duration','replacement-playback',101);
select is((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='full'),0::numeric,'duration change cannot reuse old identity');
select public.adp_sync_verified_duration((select video_id from adp_test_fixtures where name='full'),'replacement-same-duration','replacement-playback',99);
select is((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='full'),0::numeric,'shorter duration cannot reuse old identity');
select set_config('request.jwt.claim.role','authenticated',true);
select pg_temp.reset_adp_fixture('reposition',0,false,0,0);
select pg_temp.seed_adp_intervals('reposition','[[0,100]]','legacy');
select is(pg_temp.adp_hb('reposition',gen_random_uuid(),0,1,50,false,'seek')->>'code','unwatched_forward_seek','legacy intervals cannot authorize seeking');
select pg_temp.reset_adp_fixture('preserve',0,true,10,0);
select pg_temp.adp_hb('preserve','dd000000-0000-4000-8000-000000000001',0,1,5,true,'periodic');
select is(pg_temp.adp_hb('preserve','dd000000-0000-4000-8000-000000000001',0,1,6,true,'periodic')->>'code','request_id_reused','conflicting duplicate payload cannot execute');
select public.adp_admin_progress('a1000000-0000-4000-8000-000000000001',(select video_id from adp_test_fixtures where name='preserve'),'progress-reset');
select is(pg_temp.adp_hb('preserve',gen_random_uuid(),2,2,6,true,'periodic')->>'code','session_inactive','reset session cannot add new evidence');
select is((select count(*) from public.watched_intervals i join adp_test_fixtures f using(video_id) where f.name='preserve' and reset_at is not null),1::bigint,'reset preserves retired evidence');
select is((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='preserve'),0::numeric,'reset clears current coverage');
select ok((pg_temp.adp_hb('preserve','dd000000-0000-4000-8000-000000000001',0,1,5,true,'periodic')->>'duplicate')::boolean,'pre-reset accepted request keeps original receipt');
select is((select verified_watched_seconds from public.user_video_progress p join adp_test_fixtures f using(video_id) where f.name='preserve'),0::numeric,'duplicate cannot resurrect reset coverage');
-- Even privileged ordinary UPDATE cannot relabel evidence.
select throws_ok($q$update public.watched_intervals set verification_source='legacy' where verification_source='release_1_2'$q$,'P0001','immutable interval evidence','provenance update guard rejects relabeling');
set local role authenticated;
select throws_ok($q$update public.watched_intervals set completion_eligible=true$q$,'42501',null,'member cannot update interval eligibility');
reset role;
-- A failing audit insert rolls the complete override statement back.
create function pg_temp.reject_audit() returns trigger language plpgsql as $$begin raise exception 'injected audit failure';end$$;
create trigger injected_audit_failure before insert on public.admin_audit_log for each row execute function pg_temp.reject_audit();
select throws_ok($q$select public.adp_admin_progress('a1000000-0000-4000-8000-000000000001',(select video_id from adp_test_fixtures where name='missing_start'),'progress-complete')$q$,'P0001','injected audit failure','audit failure aborts override');
select is((select count(*) from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='missing_start'),0::bigint,'failed audit leaves no override');
drop trigger injected_audit_failure on public.admin_audit_log;
select public.adp_admin_progress('a1000000-0000-4000-8000-000000000001',(select video_id from adp_test_fixtures where name='missing_start'),'progress-complete');
select is((select method from public.completion_records c join adp_test_fixtures f using(video_id) where f.name='missing_start'),'admin_override','successful override is explicitly historical');
select is((select count(*) from public.verified_completion_records c join adp_test_fixtures f using(video_id) where f.name='missing_start'),0::bigint,'override does not establish verified completion');
update public.adp_playback_control set enabled=false;
select is(public.adp_playback_integrity_version(),null::integer,'disabled database gate reports no ready API');
select is(pg_temp.adp_hb('preserve',gen_random_uuid(),2,3,0,false,'pause')->>'code','playback_maintenance','heartbeat disabled by database gate');
select throws_ok($q$select public.adp_admin_progress('a1000000-0000-4000-8000-000000000001',(select video_id from adp_test_fixtures where name='missing_start'),'progress-complete')$q$,'P0001','maintenance','admin RPC disabled in maintenance');
select * from extensions.finish();
rollback;
