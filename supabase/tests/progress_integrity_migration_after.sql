-- Run after migrations 005/006/007 against the same disposable database.
do $$
declare before_state public.adp_release12_migration_snapshot%rowtype;
        after_intervals jsonb; after_progress jsonb; after_completions jsonb;
begin
  select * into before_state from public.adp_release12_migration_snapshot
    where fixture_id='a1110000-0000-4000-8000-000000000001';
  if not found then raise exception 'pre-migration snapshot is missing'; end if;
  select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'video_id',video_id,
      'start_seconds',start_seconds,'end_seconds',end_seconds,'created_at',created_at) order by i.id)
    into after_intervals from public.watched_intervals i where user_id=before_state.fixture_id;
  select jsonb_build_object('user_id',p.user_id,'video_id',p.video_id,'watched_seconds',p.watched_seconds,'completed_at',p.completed_at,'updated_at',p.updated_at)
    into after_progress from public.user_video_progress p where user_id=before_state.fixture_id;
  select jsonb_agg(to_jsonb(c) order by c.video_id) into after_completions from public.completion_records c where user_id=before_state.fixture_id;
  if after_intervals is distinct from before_state.intervals then raise exception 'migration changed historical watched intervals'; end if;
  if exists(select 1 from public.watched_intervals where user_id=before_state.fixture_id and verification_source<>'legacy') then
    raise exception 'pre-Release 1.2 intervals were promoted instead of marked legacy';
  end if;
  if after_progress is distinct from before_state.progress then raise exception 'migration changed historical progress'; end if;
  if after_completions is distinct from before_state.completions then raise exception 'migration changed historical completions'; end if;
  if exists(select 1 from public.verified_completion_records where user_id=before_state.fixture_id) then
    raise exception 'migration manufactured verified completions from historical records';
  end if;
end $$;
delete from public.authorized_discord_ids where discord_id='991110000000000001';
delete from public.videos where id='a1110000-0000-4000-8000-000000000002';
delete from auth.users where id='a1110000-0000-4000-8000-000000000001';
drop table public.adp_release12_migration_snapshot;
