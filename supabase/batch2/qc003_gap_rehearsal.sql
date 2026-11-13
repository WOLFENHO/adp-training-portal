-- Disposable Release 121 database ONLY; apply qc003_gap_candidate.sql first.
-- Requires session setting adp.qc_isolated='confirmed-nonproduction'.
begin;
do $$begin
 if current_setting('adp.qc_isolated',true) is distinct from 'confirmed-nonproduction' then
   raise exception 'QC rehearsal requires explicit isolated database marker';
 end if;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qc003-disposable@example.invalid','',clock_timestamp(),
  '{"provider":"discord","providers":["discord"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());
insert into public.profiles(id,discord_id,username) values('b1000000-0000-4000-8000-000000000001','888888888888888881','QC disposable user');
insert into public.authorized_discord_ids(discord_id,added_by) values('888888888888888881','qc fixture');
insert into public.videos(id,title,description,asset_id,playback_id,duration_seconds,legacy_duration_seconds,duration_precision_verified,published)
values('b2000000-0000-4000-8000-000000000001','QC gap fixture','disposable','qc-asset','qc-playback',100,100,true,true);
update public.adp_playback_control set enabled=true where singleton;
insert into public.playback_sessions(id,user_id,video_id,last_position,last_heartbeat_at,started_at,is_playing,active,session_version,last_event_sequence,active_since,playback_budget_seconds,asset_identity)
select 'b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',id,0,clock_timestamp()-interval '21 seconds',clock_timestamp()-interval '1 minute',true,true,0,0,clock_timestamp()-interval '21 seconds',0,public.adp_asset_identity(v)
from public.videos v where id='b2000000-0000-4000-8000-000000000001';
insert into public.playback_sessions(id,user_id,video_id,last_position,last_heartbeat_at,started_at,is_playing,active,session_version,last_event_sequence,active_since,playback_budget_seconds,asset_identity)
select 'b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001',id,0,clock_timestamp()-interval '19.5 seconds',clock_timestamp()-interval '1 minute',true,true,0,0,clock_timestamp()-interval '19.5 seconds',0,public.adp_asset_identity(v)
from public.videos v where id='b2000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

do $$declare r jsonb; repeated jsonb; resumed jsonb; begin
 r:=public.record_playback_heartbeat_r12('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',0,1,21,true,'periodic');
 if r->>'code' is distinct from 'heartbeat_gap_exceeded' then raise exception 'long gap accepted: %',r->>'code'; end if;
 repeated:=public.record_playback_heartbeat_r12('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',0,1,21,true,'periodic');
 if repeated->>'code' is distinct from 'heartbeat_gap_exceeded' or repeated->>'duplicate' is distinct from 'true' then raise exception 'duplicate receipt diverged'; end if;
 if exists(select 1 from public.watched_intervals where video_id='b2000000-0000-4000-8000-000000000001') or
    exists(select 1 from public.verified_completion_records where video_id='b2000000-0000-4000-8000-000000000001') then
   raise exception 'gap created playback evidence';
 end if;
 resumed:=public.record_playback_heartbeat_r12('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002',1,2,0,true,'play');
 if resumed->>'accepted' is distinct from 'true' then raise exception 'fresh play did not resume'; end if;
 r:=public.record_playback_heartbeat_r12('b3000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000003',0,1,1,true,'periodic');
 if r->>'accepted' is distinct from 'true' then raise exception 'short gap was rejected'; end if;
end $$;
rollback;
