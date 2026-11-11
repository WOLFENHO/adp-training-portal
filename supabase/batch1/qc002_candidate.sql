-- Candidate only. Never apply to Production without fingerprint, role-matrix and rollback approval.
-- Changes the single shared admin predicate used by existing SELECT policies.
CREATE OR REPLACE FUNCTION public.is_administrator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_authorized()
     and exists(select 1 from public.administrator_roles where discord_id=public.current_discord_id())
$function$;
-- CREATE OR REPLACE preserves the existing owner and function ACL.
