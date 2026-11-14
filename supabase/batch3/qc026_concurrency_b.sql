-- DISPOSABLE database only. Start during A's five-second row lock.
begin;
set local lock_timeout='10s';
do $$begin if current_setting('adp.qc_isolated',true) is distinct from 'confirmed-nonproduction'
  then raise exception 'isolated marker required'; end if; end $$;
do $$declare claimed integer;begin
  update public.adp_upload_intents set state='creating',lease_until=clock_timestamp()+interval '1 minute'
  where operation_id='11111111-1111-4111-8111-111111111126' and state='reserved';
  get diagnostics claimed=row_count;
  if claimed<>0 then raise exception 'concurrent claim unexpectedly succeeded'; end if;
end $$;
rollback;
