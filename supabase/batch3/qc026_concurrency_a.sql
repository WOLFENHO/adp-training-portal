-- DISPOSABLE committed fixture required: reserved intent with operation ID below.
begin;
do $$begin if current_setting('adp.qc_isolated',true) is distinct from 'confirmed-nonproduction'
  then raise exception 'isolated marker required'; end if; end $$;
do $$declare claimed integer;begin
  update public.adp_upload_intents set state='creating',lease_until=clock_timestamp()+interval '1 minute'
  where operation_id='11111111-1111-4111-8111-111111111126' and state='reserved';
  get diagnostics claimed=row_count;
  if claimed<>1 then raise exception 'disposable reserved intent missing'; end if;
end $$;
select pg_sleep(5); -- Start session B while this row lock is held.
commit;
