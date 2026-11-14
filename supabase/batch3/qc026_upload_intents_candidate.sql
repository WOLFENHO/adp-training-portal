-- ISOLATED CANDIDATE ONLY. No production application caller or migration approval.
begin;
create table public.adp_upload_intents (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  video_id uuid not null unique references public.videos(id) on delete restrict,
  state text not null check (state in ('reserved','creating','waiting','uploaded','asset_created','needs_reconciliation','manual_review')),
  mux_upload_id text unique,
  mux_asset_id text,
  signed_playback_id text,
  upload_url text,
  url_expires_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((mux_upload_id is null and upload_url is null and url_expires_at is null) or
         (mux_upload_id is not null and upload_url is not null and url_expires_at is not null)),
  check ((state='asset_created' and mux_asset_id is not null and signed_playback_id is not null and
          length(mux_asset_id)>0 and length(signed_playback_id)>0) or
         (state<>'asset_created' and mux_asset_id is null and signed_playback_id is null))
);
create index adp_upload_intents_state_age on public.adp_upload_intents(state,updated_at);
create function public.adp_upload_intent_guard_qc026() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v public.videos%rowtype;
begin
  if tg_op='INSERT' then
    if new.state<>'reserved' or new.mux_upload_id is not null or
       new.mux_asset_id is not null or new.signed_playback_id is not null then
      raise exception using errcode='22023',message='invalid initial upload intent';
    end if;
    return new;
  end if;
  if old.operation_id is distinct from new.operation_id or
     old.actor_id is distinct from new.actor_id or
     old.video_id is distinct from new.video_id or
     old.request_hash is distinct from new.request_hash or
     (old.mux_upload_id is not null and old.mux_upload_id is distinct from new.mux_upload_id) or
     (old.mux_asset_id is not null and old.mux_asset_id is distinct from new.mux_asset_id) or
     (old.signed_playback_id is not null and old.signed_playback_id is distinct from new.signed_playback_id) then
    raise exception using errcode='22023',message='upload intent identity is immutable';
  end if;
  if old.state='asset_created' or (old.state is distinct from new.state and not (
    (old.state='reserved' and new.state in ('creating','needs_reconciliation')) or
    (old.state='creating' and new.state in ('waiting','needs_reconciliation')) or
    (old.state='waiting' and new.state in ('uploaded','asset_created','needs_reconciliation')) or
    (old.state='uploaded' and new.state in ('asset_created','needs_reconciliation')) or
    (old.state='needs_reconciliation' and new.state in ('manual_review','waiting')) or
    (old.state='manual_review' and new.state in ('waiting','asset_created')))) then
    raise exception using errcode='22023',message='invalid upload intent transition';
  end if;
  if new.state='asset_created' then
    select * into v from public.videos where id=new.video_id for share;
    if not found or new.mux_upload_id is null or
       v.mux_upload_id is distinct from new.mux_upload_id or
       v.asset_id is distinct from new.mux_asset_id or
       v.playback_id is distinct from new.signed_playback_id then
      raise exception using errcode='22023',message='upload asset binding does not match video';
    end if;
  end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.adp_upload_intent_guard_qc026() from public,anon,authenticated;
create trigger adp_upload_intent_immutable before insert or update on public.adp_upload_intents
for each row execute function public.adp_upload_intent_guard_qc026();
alter table public.adp_upload_intents enable row level security;
revoke all on public.adp_upload_intents from public,anon,authenticated;
-- No client role may read the signed upload URL. Server-side service-role access
-- requires a separate isolated authorization and transaction review.
grant select,insert,update on public.adp_upload_intents to service_role;
commit;
