-- Apply only after the reviewed QC-026 candidate, on an independently verified target.
-- A recovered provider upload remains bound to its original reserved video.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
do $$ begin
  if current_user <> 'postgres' then raise exception 'trusted function owner required'; end if;
end $$;
create function public.adp_reconcile_upload_intent_qc026(
  p_actor_id uuid, p_operation_id uuid, p_upload_id text, p_upload_url text, p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.adp_upload_intents%rowtype; v public.videos%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(p_actor_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if nullif(p_upload_id,'') is null or nullif(p_upload_url,'') is null or
     p_expires_at is null or p_expires_at<=clock_timestamp() then
    raise exception 'invalid provider target' using errcode='22023';
  end if;
  select * into r from public.adp_upload_intents where operation_id=p_operation_id for update;
  if not found or r.actor_id<>p_actor_id or r.state not in ('needs_reconciliation','manual_review') or
     r.mux_upload_id is not null then return false; end if;
  select * into v from public.videos where id=r.video_id for update;
  if not found or v.published or v.mux_upload_id is not null or v.asset_id is not null or
     v.playback_id is not null then return false; end if;
  update public.videos set mux_upload_id=p_upload_id where id=r.video_id;
  update public.adp_upload_intents set state='waiting',mux_upload_id=p_upload_id,
    upload_url=p_upload_url,url_expires_at=p_expires_at,lease_until=null
    where operation_id=p_operation_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(p_actor_id,'video-upload-reconciled',jsonb_build_object('videoId',r.video_id,'operationId',p_operation_id));
  return true;
end $$;
revoke all on function public.adp_reconcile_upload_intent_qc026(uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.adp_reconcile_upload_intent_qc026(uuid,uuid,text,text,timestamptz)
  to service_role;

-- A first upload has no training history. Verify its signed Mux metadata and
-- finalize the intent atomically without changing the maintenance-only legacy
-- metadata synchronization function or recalculating any progress.
create function public.adp_verify_new_upload_qc026(
  p_actor_id uuid,p_video_id uuid,p_upload_id text,p_asset_id text,
  p_playback_id text,p_duration numeric
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.adp_upload_intents%rowtype; v public.videos%rowtype;
begin
  if not public.adp_upload_actor_authorized_qc026(p_actor_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if nullif(p_upload_id,'') is null or nullif(p_asset_id,'') is null or
     nullif(p_playback_id,'') is null or p_duration is null or
     round(p_duration,3)<=0 or p_duration>999999999 then
    raise exception 'invalid provider metadata' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_asset_id,26));
  perform pg_advisory_xact_lock(hashtextextended(p_playback_id,27));
  select * into r from public.adp_upload_intents where video_id=p_video_id for update;
  if not found or r.actor_id<>p_actor_id or r.state not in ('waiting','uploaded') or
     r.mux_upload_id is distinct from p_upload_id then return false; end if;
  select * into v from public.videos where id=p_video_id for update;
  if not found or v.published or v.mux_upload_id is distinct from p_upload_id or
     v.asset_id is not null or v.playback_id is not null or v.duration_precision_verified or
     exists(select 1 from public.user_video_progress where video_id=p_video_id) or
     exists(select 1 from public.watched_intervals where video_id=p_video_id) or
     exists(select 1 from public.playback_sessions where video_id=p_video_id) or
     exists(select 1 from public.completion_records where video_id=p_video_id) or
     exists(select 1 from public.verified_completion_records where video_id=p_video_id) or
     exists(select 1 from public.videos where id<>p_video_id and
       (asset_id=p_asset_id or playback_id=p_playback_id)) or
     exists(select 1 from public.adp_upload_intents where video_id<>p_video_id and
       (mux_asset_id=p_asset_id or signed_playback_id=p_playback_id))
  then return false; end if;
  update public.videos set asset_id=p_asset_id,playback_id=p_playback_id,
    duration_seconds=round(p_duration,3),duration_precision_verified=true,
    duration_verified_at=clock_timestamp() where id=p_video_id;
  update public.adp_upload_intents set state='asset_created',mux_asset_id=p_asset_id,
    signed_playback_id=p_playback_id where operation_id=r.operation_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(p_actor_id,'video-upload-verified',jsonb_build_object('videoId',p_video_id,'operationId',r.operation_id));
  return true;
end $$;
revoke all on function public.adp_verify_new_upload_qc026(uuid,uuid,text,text,text,numeric)
  from public,anon,authenticated,service_role;
grant execute on function public.adp_verify_new_upload_qc026(uuid,uuid,text,text,text,numeric)
  to service_role;
commit;
