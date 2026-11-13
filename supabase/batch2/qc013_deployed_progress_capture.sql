CREATE OR REPLACE FUNCTION public.adp_admin_progress(p_user_id uuid, p_video_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid();
begin
 if actor is null or not public.is_authorized() or not public.is_administrator() then raise exception 'not authorized'; end if;
 if not exists(select 1 from public.adp_playback_control where enabled and singleton) then raise exception 'maintenance'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_video_id::text,0));
 perform 1 from public.playback_sessions where user_id=p_user_id and video_id=p_video_id order by id for update;
 if p_action='progress-reset' then
 update public.playback_sessions set active=false,is_playing=false,active_since=null,playback_budget_seconds=0,session_version=session_version+1 where user_id=p_user_id and video_id=p_video_id;
 update public.watched_intervals set reset_at=clock_timestamp() where user_id=p_user_id and video_id=p_video_id and reset_at is null;
 update public.verified_completion_records set reset_at=clock_timestamp() where user_id=p_user_id and video_id=p_video_id and reset_at is null;
 update public.user_video_progress set verified_watched_seconds=0 where user_id=p_user_id and video_id=p_video_id;
 elsif p_action='progress-complete' then
 insert into public.completion_records(user_id,video_id,method,admin_id) values(p_user_id,p_video_id,'admin_override',actor) on conflict do nothing;
 else raise exception 'invalid action'; end if;
 insert into public.admin_audit_log(admin_id,action,details) values(actor,p_action,jsonb_build_object('userId',p_user_id,'videoId',p_video_id));
 return jsonb_build_object('ok',true);
end $function$
