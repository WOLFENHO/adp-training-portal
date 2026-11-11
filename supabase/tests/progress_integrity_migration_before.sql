-- Run on a disposable local Supabase database after migrations 001-004 and
-- before 005/006/007. This fixture intentionally commits so the post-check can see it.
do $$ begin
  if coalesce(current_setting('adp.allow_progress_migration_fixture',true),'')<>'on' then
    raise exception 'Set adp.allow_progress_migration_fixture=on only on a disposable local database';
  end if;
  if exists(select 1 from auth.users where id='a1110000-0000-4000-8000-000000000001') then
    raise exception 'Migration fixture already exists; use a fresh disposable database';
  end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('a1110000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'adp-migration-preservation@example.invalid','',clock_timestamp(),'{"provider":"discord","providers":["discord"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp());
insert into public.profiles(id,discord_id,username) values('a1110000-0000-4000-8000-000000000001','991110000000000001','ADP migration fixture');
insert into public.authorized_discord_ids(discord_id,added_by) values('991110000000000001','local-test');
insert into public.videos(id,title,description,duration_seconds,published)
values('a1110000-0000-4000-8000-000000000002','Migration fixture','preservation test',100,true);
insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds)
values('a1110000-0000-4000-8000-000000000001','a1110000-0000-4000-8000-000000000002',0,42.25);
insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at,updated_at)
values('a1110000-0000-4000-8000-000000000001','a1110000-0000-4000-8000-000000000002',42.25,'2026-01-02T03:04:05Z','2026-01-02T03:04:05Z');
insert into public.completion_records(user_id,video_id,completed_at,method)
values('a1110000-0000-4000-8000-000000000001','a1110000-0000-4000-8000-000000000002','2026-01-02T03:04:05Z','admin_override');
create table public.adp_release12_migration_snapshot(
  fixture_id uuid primary key,
  intervals jsonb not null,
  progress jsonb not null,
  completions jsonb not null
);
insert into public.adp_release12_migration_snapshot
select 'a1110000-0000-4000-8000-000000000001',
  (select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'video_id',video_id,'start_seconds',start_seconds,'end_seconds',end_seconds,'created_at',created_at) order by i.id) from public.watched_intervals i where user_id='a1110000-0000-4000-8000-000000000001'),
  (select jsonb_build_object('user_id',p.user_id,'video_id',p.video_id,'watched_seconds',p.watched_seconds,'completed_at',p.completed_at,'updated_at',p.updated_at)
    from public.user_video_progress p where user_id='a1110000-0000-4000-8000-000000000001'),
  (select jsonb_agg(to_jsonb(c) order by c.video_id) from public.completion_records c where user_id='a1110000-0000-4000-8000-000000000001');

