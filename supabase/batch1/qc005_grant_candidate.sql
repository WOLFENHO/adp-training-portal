-- ISOLATED CANDIDATE. Capture the live function definition, owner and ACL first.
-- The expected hash is supplied only after matching the current deployed body.
begin;
do $$
declare fn oid := to_regprocedure('public.adp_admin_progress(uuid,uuid,text)');
        definition text; expected text := current_setting('adp.qc005_expected_definition_md5',true);
begin
  if fn is null or expected is null or expected !~ '^[a-f0-9]{32}$' then
    raise exception 'QC-005 function fingerprint missing' using errcode='22023';
  end if;
  definition := pg_get_functiondef(fn);
  if md5(definition) <> expected or definition !~ 'auth.uid\(\)' or
     definition !~ 'is_authorized\(\)' or definition !~ 'is_administrator\(\)' then
    raise exception 'QC-005 administrator authorization definition changed' using errcode='22023';
  end if;
end $$;
revoke all on function public.adp_admin_progress(uuid,uuid,text) from public,anon;
grant execute on function public.adp_admin_progress(uuid,uuid,text) to authenticated;
commit;
