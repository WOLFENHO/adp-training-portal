create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  discord_id text not null unique,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create table public.authorized_discord_ids (
  discord_id text primary key,
  added_by text not null,
  added_at timestamptz not null default now()
);
create table public.administrator_roles (
  discord_id text primary key,
  granted_by text not null,
  granted_at timestamptz not null default now()
);
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  thumbnail_url text,
  asset_id text unique,
  playback_id text unique,
  mux_upload_id text,
  duration_seconds integer not null default 0 check(duration_seconds >= 0),
  sort_order integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_video_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  watched_seconds numeric(10,2) not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,video_id)
);
create table public.watched_intervals (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  start_seconds numeric(10,2) not null check(start_seconds >= 0),
  end_seconds numeric(10,2) not null check(end_seconds > start_seconds),
  created_at timestamptz not null default now()
);
create index watched_intervals_lookup on public.watched_intervals(user_id,video_id,start_seconds,end_seconds);
create table public.completion_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  completed_at timestamptz not null default now(),
  method text not null check(method in ('playback','admin_override')),
  admin_id uuid references public.profiles(id) on delete set null,
  primary key(user_id,video_id)
);
create table public.playback_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  last_position numeric(10,2) not null default 0,
  last_heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  is_playing boolean not null default false,
  active boolean not null default true
);
create index playback_sessions_user_video on public.playback_sessions(user_id,video_id,active);
create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.current_discord_id() returns text language sql stable security definer set search_path=public as $$
  select discord_id from public.profiles where id=auth.uid()
$$;
create or replace function public.is_authorized() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.authorized_discord_ids where discord_id=public.current_discord_id())
$$;
create or replace function public.is_administrator() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.administrator_roles where discord_id=public.current_discord_id())
$$;

alter table public.profiles enable row level security;
alter table public.authorized_discord_ids enable row level security;
alter table public.administrator_roles enable row level security;
alter table public.videos enable row level security;
alter table public.user_video_progress enable row level security;
alter table public.watched_intervals enable row level security;
alter table public.completion_records enable row level security;
alter table public.playback_sessions enable row level security;
alter table public.admin_audit_log enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_administrator());
create policy whitelist_read on public.authorized_discord_ids for select to authenticated using(public.is_administrator());
create policy admin_roles_read on public.administrator_roles for select to authenticated using(public.is_administrator());
create policy videos_read on public.videos for select to authenticated using((published and public.is_authorized()) or public.is_administrator());
create policy progress_read on public.user_video_progress for select to authenticated using(user_id=auth.uid() or public.is_administrator());
create policy intervals_read on public.watched_intervals for select to authenticated using(user_id=auth.uid() or public.is_administrator());
create policy completion_read on public.completion_records for select to authenticated using(user_id=auth.uid() or public.is_administrator());
create policy sessions_read on public.playback_sessions for select to authenticated using(user_id=auth.uid() or public.is_administrator());
create policy audit_read on public.admin_audit_log for select to authenticated using(public.is_administrator());

grant select on public.profiles,public.authorized_discord_ids,public.administrator_roles,public.videos,public.user_video_progress,public.watched_intervals,public.completion_records,public.playback_sessions,public.admin_audit_log to authenticated;

create or replace function public.start_playback_session(p_video_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); dur integer; pos numeric:=0; r record; sid uuid; already_done boolean;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  select duration_seconds into dur from public.videos where id=p_video_id and published;
  if dur is null or dur<=0 then raise exception 'video unavailable'; end if;
  select exists(select 1 from public.completion_records where user_id=uid and video_id=p_video_id) into already_done;
  if already_done then pos:=0; end if;
  if not already_done then
    for r in select start_seconds,end_seconds from public.watched_intervals where user_id=uid and video_id=p_video_id order by start_seconds loop
      if r.start_seconds > pos + 0.5 then exit; end if;
      pos:=greatest(pos,r.end_seconds);
    end loop;
    pos:=least(pos,greatest(dur-0.25,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text || p_video_id::text,0));
  update public.playback_sessions set active=false where user_id=uid and video_id=p_video_id and active;
  insert into public.playback_sessions(user_id,video_id,last_position) values(uid,p_video_id,pos) returning id into sid;
  update public.profiles set last_seen_at=now() where id=uid;
  return jsonb_build_object('sessionId',sid,'position',pos);
end $$;

create or replace function public.record_playback_heartbeat(p_session_id uuid,p_position numeric,p_is_playing boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); s public.playback_sessions%rowtype; dur integer; elapsed numeric; delta numeric; pos numeric; r record; run_start numeric; run_end numeric; covered numeric:=0; total numeric:=0; pct numeric:=0; done boolean:=false;
begin
  if uid is null or not public.is_authorized() then raise exception 'not authorized'; end if;
  select * into s from public.playback_sessions where id=p_session_id and user_id=uid and active for update;
  if not found or s.started_at < now()-interval '12 hours' then raise exception 'session expired'; end if;
  select duration_seconds into dur from public.videos where id=s.video_id and published;
  if dur is null or dur<=0 then raise exception 'video unavailable'; end if;
  if p_position < 0 or p_position > dur+1 then raise exception 'invalid position'; end if;
  pos:=least(p_position,dur::numeric);
  elapsed:=case when s.is_playing then greatest(0,extract(epoch from (now()-s.last_heartbeat_at))) else 0 end;
  delta:=pos-s.last_position;
  if delta > elapsed*1.25+2.5 then raise exception 'playback advanced too quickly'; end if;
  if delta < -0.5 and not exists(select 1 from public.watched_intervals where user_id=uid and video_id=s.video_id and start_seconds<=pos and end_seconds>=pos) then raise exception 'cannot seek to an unwatched section'; end if;
  if delta > 0 then
    insert into public.watched_intervals(user_id,video_id,start_seconds,end_seconds) values(uid,s.video_id,s.last_position,pos) on conflict do nothing;
  end if;
  update public.playback_sessions set last_position=pos,last_heartbeat_at=now(),is_playing=p_is_playing where id=s.id;
  update public.profiles set last_seen_at=now() where id=uid;
  -- Coalesce any overlapping playback intervals so percentage and completion use unique covered time.
  for r in select start_seconds,end_seconds from public.watched_intervals where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end+0.05 then run_end:=greatest(run_end,r.end_seconds);
    else
      total:=total+(run_end-run_start);
      if run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if;
      run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null then
    total:=total+(run_end-run_start);
    if run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if;
  end if;
  -- Completion requires the merged interval chain to have no meaningful gaps.
  covered:=0;
  run_start:=null;run_end:=null;
  for r in select start_seconds,end_seconds from public.watched_intervals where user_id=uid and video_id=s.video_id order by start_seconds,end_seconds loop
    if run_start is null then run_start:=r.start_seconds;run_end:=r.end_seconds;
    elsif r.start_seconds<=run_end+0.75 then run_end:=greatest(run_end,r.end_seconds);
    else if run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if; run_start:=r.start_seconds;run_end:=r.end_seconds;
    end if;
  end loop;
  if run_start is not null and run_start<=0.75 and run_end>=dur-0.75 then covered:=dur; end if;
  done:=covered>=dur;
  pct:=least(100,round(total/greatest(dur,1)*100,1));
  insert into public.user_video_progress(user_id,video_id,watched_seconds,completed_at,updated_at) values(uid,s.video_id,total,case when done then now() else null end,now())
   on conflict(user_id,video_id) do update set watched_seconds=excluded.watched_seconds,completed_at=case when public.user_video_progress.completed_at is not null then public.user_video_progress.completed_at else excluded.completed_at end,updated_at=now();
  if done then insert into public.completion_records(user_id,video_id,method) values(uid,s.video_id,'playback') on conflict(user_id,video_id) do nothing; end if;
  return jsonb_build_object('acceptedPosition',pos,'percent',pct,'complete',done,'intervals',(select coalesce(jsonb_agg(jsonb_build_object('start_seconds',start_seconds,'end_seconds',end_seconds) order by start_seconds),'[]'::jsonb) from public.watched_intervals where user_id=uid and video_id=s.video_id));
end $$;
revoke all on function public.start_playback_session(uuid) from public;
revoke all on function public.record_playback_heartbeat(uuid,numeric,boolean) from public;
grant execute on function public.start_playback_session(uuid) to authenticated;
grant execute on function public.record_playback_heartbeat(uuid,numeric,boolean) to authenticated;
