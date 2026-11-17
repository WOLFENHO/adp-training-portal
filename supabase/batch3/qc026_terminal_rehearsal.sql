-- DISPOSABLE RELEASE 121 DATABASE ONLY. Requires adp.qc_isolated and disposable
-- adp.qc_actor / adp.qc_video UUID settings. All changes roll back.
begin;
do $$begin
  if current_setting('adp.qc_isolated',true) is distinct from 'confirmed-nonproduction' then
    raise exception 'QC-026 isolated marker required';
  end if;
  if not exists(select 1 from public.profiles where id=current_setting('adp.qc_actor',true)::uuid) or
     not exists(select 1 from public.videos where id=current_setting('adp.qc_video',true)::uuid and not published) then
    raise exception 'QC-026 disposable profile and unpublished video required';
  end if;
end $$;

insert into public.adp_upload_intents(operation_id,actor_id,request_hash,video_id,state)
values('11111111-1111-4111-8111-111111111126',current_setting('adp.qc_actor')::uuid,
       repeat('a',64),current_setting('adp.qc_video')::uuid,'reserved');
update public.adp_upload_intents set state='creating',lease_until=clock_timestamp()+interval '1 minute'
where operation_id='11111111-1111-4111-8111-111111111126';
update public.adp_upload_intents set state='waiting',mux_upload_id='qc026upload',
  upload_url='https://disposable.invalid/upload',url_expires_at=clock_timestamp()+interval '1 hour'
where operation_id='11111111-1111-4111-8111-111111111126';

-- Wrong asset identity cannot be recorded as a terminal binding.
update public.videos set mux_upload_id='qc026upload',asset_id='qc026assetB',playback_id='qc026playback'
where id=current_setting('adp.qc_video')::uuid;
do $$declare rejected boolean:=false;begin
  begin
    update public.adp_upload_intents set state='asset_created',mux_asset_id='qc026assetA',
      signed_playback_id='qc026playback' where operation_id='11111111-1111-4111-8111-111111111126';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'mismatched asset reached terminal state'; end if;
end $$;

update public.videos set asset_id='qc026assetA' where id=current_setting('adp.qc_video')::uuid;
update public.adp_upload_intents set state='asset_created',mux_asset_id='qc026assetA',
  signed_playback_id='qc026playback' where operation_id='11111111-1111-4111-8111-111111111126';
do $$declare rejected boolean:=false;begin
  if not exists(select 1 from public.adp_upload_intents where operation_id='11111111-1111-4111-8111-111111111126'
       and state='asset_created' and mux_asset_id='qc026assetA') then raise exception 'terminal binding missing'; end if;
  begin
    update public.adp_upload_intents set state='manual_review'
    where operation_id='11111111-1111-4111-8111-111111111126';
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'terminal state was mutable'; end if;
end $$;

-- A failure after a video update must roll that update back in its subtransaction.
do $$declare before_title text;begin
  select title into before_title from public.videos where id=current_setting('adp.qc_video')::uuid;
  begin
    update public.videos set title='QC-026 failure injection' where id=current_setting('adp.qc_video')::uuid;
    raise exception 'injected reconciliation failure';
  exception when others then null; end;
  if (select title from public.videos where id=current_setting('adp.qc_video')::uuid) is distinct from before_title then
    raise exception 'failed reconciliation left video mutation';
  end if;
end $$;
rollback;
