-- ADP-Rehearsal only. Execute after exact-ID fixture cleanup and before the
-- pinned base QC-026 schema cleanup. Never use CASCADE.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
do $$ begin
  if current_user <> 'postgres' or to_regclass('public.adp_upload_intents') is null then
    raise exception 'trusted owner and QC-026 ledger required';
  end if;
  if to_regprocedure('public.adp_reconcile_upload_intent_qc026(uuid,uuid,text,text,timestamptz)') is null then
    raise exception 'reconciliation function missing; stop cleanup';
  end if;
  if to_regprocedure('public.adp_verify_new_upload_qc026(uuid,uuid,text,text,text,numeric)') is null then
    raise exception 'new upload verifier missing; stop cleanup';
  end if;
  if exists (select 1 from public.adp_upload_intents) then
    raise exception 'upload intents remain; inspect fixtures before cleanup';
  end if;
end $$;
drop function public.adp_verify_new_upload_qc026(uuid,uuid,text,text,text,numeric);
drop function public.adp_reconcile_upload_intent_qc026(uuid,uuid,text,text,timestamptz);
commit;
