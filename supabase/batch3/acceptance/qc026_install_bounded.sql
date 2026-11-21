-- ISOLATED CANDIDATE ONLY. No production application caller or migration approval.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
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
revoke all on function public.adp_upload_intent_guard_qc026() from public,anon,authenticated,service_role;
create trigger adp_upload_intent_immutable before insert or update on public.adp_upload_intents
for each row execute function public.adp_upload_intent_guard_qc026();
alter table public.adp_upload_intents enable row level security;
revoke all on public.adp_upload_intents from public,anon,authenticated,service_role;
-- No client role may read the signed upload URL. Server-side service-role access
-- requires a separate isolated authorization and transaction review.
grant select,insert,update on public.adp_upload_intents to service_role;

-- Only the server's service role can invoke these RPCs. A fresh database
-- whitelist/admin check is still required for the actor authenticated by the
-- application. Direct authenticated Data API callers cannot supply provider
-- identifiers to the privileged binding RPC.
create function public.adp_upload_actor_authorized_qc026(p_actor_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.profiles p
    join public.authorized_discord_ids w on w.discord_id=p.discord_id
    join public.administrator_roles a on a.discord_id=p.discord_id
    where p.id=p_actor_id
  )
$$;
create function public.adp_reserve_upload_intent_qc026(
  p_actor_id uuid,p_operation_id uuid,p_video_id uuid,p_request_hash text,p_title text,p_description text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=p_actor_id; r public.adp_upload_intents%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(actor) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_operation_id is null or p_video_id is null or p_request_hash !~ '^[a-f0-9]{64}$' or
     length(trim(p_title)) not between 1 and 180 or length(p_description)>4000 then
    raise exception 'invalid upload request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into r from public.adp_upload_intents where operation_id=p_operation_id for update;
  if found then
    if r.actor_id<>actor or r.request_hash<>p_request_hash or r.video_id<>p_video_id then
      raise exception 'upload intent conflict' using errcode='23505';
    end if;
  else
    insert into public.videos(id,title,description,published,sort_order,mux_upload_id,duration_seconds)
      values(p_video_id,p_title,p_description,false,999,null,0);
    insert into public.adp_upload_intents(operation_id,actor_id,request_hash,video_id,state)
      values(p_operation_id,actor,p_request_hash,p_video_id,'reserved') returning * into r;
    insert into public.admin_audit_log(admin_id,action,details)
      values(actor,'video-create-reserved',jsonb_build_object('videoId',p_video_id,'operationId',p_operation_id));
  end if;
  return jsonb_build_object('operationId',r.operation_id,'actorId',r.actor_id,'payloadHash',r.request_hash,
    'videoId',r.video_id,'status',r.state,'uploadId',r.mux_upload_id,'uploadUrl',r.upload_url,
    'expiresAt',r.url_expires_at,'assetId',r.mux_asset_id,'playbackId',r.signed_playback_id);
end $$;

create function public.adp_claim_upload_intent_qc026(p_actor_id uuid,p_operation_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=p_actor_id; r public.adp_upload_intents%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(actor) then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from public.adp_upload_intents where operation_id=p_operation_id for update;
  if not found or r.actor_id<>actor or r.state<>'reserved' then return false; end if;
  update public.adp_upload_intents set state='creating',lease_until=clock_timestamp()+interval '2 minutes' where operation_id=p_operation_id;
  return true;
end $$;

create function public.adp_bind_upload_intent_qc026(
  p_actor_id uuid,p_operation_id uuid,p_upload_id text,p_upload_url text,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=p_actor_id; r public.adp_upload_intents%rowtype; v public.videos%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(actor) then raise exception 'not authorized' using errcode='42501'; end if;
  if nullif(p_upload_id,'') is null or nullif(p_upload_url,'') is null or p_expires_at<=clock_timestamp() then
    raise exception 'invalid provider target' using errcode='22023'; end if;
  select * into r from public.adp_upload_intents where operation_id=p_operation_id for update;
  if not found or r.actor_id<>actor or r.state<>'creating' then return false; end if;
  select * into v from public.videos where id=r.video_id for update;
  if not found or v.published or v.mux_upload_id is not null or v.asset_id is not null or v.playback_id is not null then return false; end if;
  update public.videos set mux_upload_id=p_upload_id where id=r.video_id;
  update public.adp_upload_intents set state='waiting',mux_upload_id=p_upload_id,
    upload_url=p_upload_url,url_expires_at=p_expires_at,lease_until=null where operation_id=p_operation_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(actor,'video-upload-bound',jsonb_build_object('videoId',r.video_id,'operationId',p_operation_id));
  return true;
end $$;

create function public.adp_mark_upload_review_qc026(p_actor_id uuid,p_operation_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=p_actor_id; r public.adp_upload_intents%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(actor) then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from public.adp_upload_intents where operation_id=p_operation_id for update;
  if not found or r.actor_id<>actor or r.state not in ('reserved','creating') then return false; end if;
  update public.adp_upload_intents set state='needs_reconciliation',lease_until=null where operation_id=p_operation_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(actor,'video-upload-review',jsonb_build_object('videoId',r.video_id,'operationId',p_operation_id));
  return true;
end $$;

create function public.adp_finalize_upload_intent_qc026(p_actor_id uuid,p_video_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=p_actor_id; r public.adp_upload_intents%rowtype; v public.videos%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(actor) then raise exception 'not authorized' using errcode='42501'; end if;
  select * into r from public.adp_upload_intents where video_id=p_video_id for update;
  if not found then return false; end if;
  if r.state not in ('waiting','uploaded','manual_review') then return false; end if;
  select * into v from public.videos where id=p_video_id for share;
  if not found or v.mux_upload_id is distinct from r.mux_upload_id or
     nullif(v.asset_id,'') is null or nullif(v.playback_id,'') is null or not v.duration_precision_verified then return false; end if;
  update public.adp_upload_intents set state='asset_created',mux_asset_id=v.asset_id,
    signed_playback_id=v.playback_id where operation_id=r.operation_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(actor,'video-upload-finalized',jsonb_build_object('videoId',p_video_id,'operationId',r.operation_id));
  return true;
end $$;

revoke all on function public.adp_upload_actor_authorized_qc026(uuid) from public,anon,authenticated,service_role;
revoke all on function public.adp_reserve_upload_intent_qc026(uuid,uuid,uuid,text,text,text),
  public.adp_claim_upload_intent_qc026(uuid,uuid),public.adp_bind_upload_intent_qc026(uuid,uuid,text,text,timestamptz),
  public.adp_mark_upload_review_qc026(uuid,uuid),public.adp_finalize_upload_intent_qc026(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.adp_reserve_upload_intent_qc026(uuid,uuid,uuid,text,text,text),
  public.adp_claim_upload_intent_qc026(uuid,uuid),public.adp_bind_upload_intent_qc026(uuid,uuid,text,text,timestamptz),
  public.adp_mark_upload_review_qc026(uuid,uuid),public.adp_finalize_upload_intent_qc026(uuid,uuid)
  to service_role;
commit;

