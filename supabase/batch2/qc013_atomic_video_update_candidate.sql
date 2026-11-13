-- ISOLATED CANDIDATE ONLY. No EXECUTE grant. Compare deployed schema first.
begin;
create or replace function public.adp_admin_update_video_qc013(
  p_video_id uuid, p_title text, p_description text,
  p_thumbnail_url text, p_published boolean, p_sort_order integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid:=auth.uid(); v public.videos%rowtype;
begin
  if actor is null or not public.is_authorized() or not public.is_administrator() then
    raise exception using errcode='42501',message='not authorized';
  end if;
  -- Serialize a concurrent whitelist/role revocation with this mutation.
  perform 1 from public.profiles p
    join public.authorized_discord_ids a on a.discord_id=p.discord_id
    join public.administrator_roles r on r.discord_id=p.discord_id
    where p.id=actor for key share of a,r;
  if not found then raise exception using errcode='42501',message='not authorized'; end if;
  if p_video_id is null or p_title is null or length(trim(p_title)) not between 1 and 180 or
     p_description is null or length(p_description)>4000 or
     (p_thumbnail_url is not null and (length(p_thumbnail_url)>2048 or
       p_thumbnail_url !~* '^https?://')) or
     p_published is null or p_sort_order is null then
    raise exception using errcode='22023',message='invalid video update';
  end if;
  select * into v from public.videos where id=p_video_id for update;
  if not found then return jsonb_build_object('ok',false,'code','video_not_found'); end if;
  if p_published and (v.playback_id is null or v.duration_seconds<=0 or
      not coalesce(v.duration_precision_verified,false)) then
    return jsonb_build_object('ok',false,'code','video_metadata_unverified');
  end if;
  update public.videos set title=trim(p_title),description=p_description,
    thumbnail_url=p_thumbnail_url,published=p_published,sort_order=p_sort_order
    where id=p_video_id;
  insert into public.admin_audit_log(admin_id,action,details)
    values(actor,'video-update',jsonb_build_object('videoId',p_video_id,'published',p_published));
  return jsonb_build_object('ok',true,'videoId',p_video_id);
end $$;
revoke all on function public.adp_admin_update_video_qc013(uuid,text,text,text,boolean,integer)
  from public,anon,authenticated;
commit;
