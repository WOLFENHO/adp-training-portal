-- Read-only baseline and postcheck; execute only against verified ADP-Rehearsal.
select
  (select version::text||':'||ready::text from public.adp_integrity_release) as release,
  to_regclass('public.adp_upload_intents') is not null as qc026_present,
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.authorized_discord_ids) as whitelist,
  (select count(*) from public.administrator_roles) as admins,
  (select count(*) from public.videos) as videos,
  (select count(*) from public.admin_audit_log) as audit_rows,
  (select count(*) from public.user_video_progress) as progress_rows,
  (select count(*) from public.verified_completion_records) as verified_rows,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from auth.users t) as protected_auth_hash,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.profiles t) as profiles_hash,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by discord_id),'')) from public.authorized_discord_ids t) as whitelist_hash,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by discord_id),'')) from public.administrator_roles t) as admins_hash,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.videos t) as videos_hash,
  (select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.admin_audit_log t) as audit_hash,
  (select md5(coalesce(string_agg(p.proname||':'||pg_get_function_identity_arguments(p.oid)||':'||p.proowner::text||':'||coalesce(p.proacl::text,'default')||':'||pg_get_functiondef(p.oid),'|' order by p.proname,pg_get_function_identity_arguments(p.oid)),''))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('is_administrator','adp_admin_progress','adp_sync_verified_duration','adp_playback_integrity_version')) as baseline_functions_hash,
  (select md5(coalesce(string_agg(c.relname||':'||c.relowner::text||':'||coalesce(c.relacl::text,'default')||':'||c.relrowsecurity::text,'|' order by c.relname),''))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname in ('profiles','authorized_discord_ids','administrator_roles','videos','admin_audit_log')) as baseline_table_acl_hash,
  (select last_value::text||':'||is_called::text from public.admin_audit_log_id_seq) as audit_sequence,
  (select last_value::text||':'||is_called::text from auth.refresh_tokens_id_seq) as auth_refresh_sequence,
  (select last_value::text||':'||is_called::text from public.watched_intervals_id_seq) as watched_sequence,
  (select count(*) from auth.audit_log_entries) as auth_audit_rows,
  (select count(*) from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and xact_start is not null) as other_open_transactions,
  (select count(*) from pg_locks where not granted) as lock_waiters;
