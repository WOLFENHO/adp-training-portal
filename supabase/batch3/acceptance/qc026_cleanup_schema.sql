-- Prepared Rehearsal-only cleanup. Run only after fixture cleanup and approval.
begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $$begin
  if to_regclass('public.adp_upload_intents') is null then
    raise exception 'QC-026 ledger is absent; stop cleanup';
  end if;
  if exists(select 1 from public.adp_upload_intents) then
    raise exception 'QC-026 ledger contains rows; stop cleanup';
  end if;
end $$;
drop function public.adp_reserve_upload_intent_qc026(uuid,uuid,uuid,text,text,text);
drop function public.adp_claim_upload_intent_qc026(uuid,uuid);
drop function public.adp_bind_upload_intent_qc026(uuid,uuid,text,text,timestamptz);
drop function public.adp_mark_upload_review_qc026(uuid,uuid);
drop function public.adp_finalize_upload_intent_qc026(uuid,uuid);
drop table public.adp_upload_intents;
drop function public.adp_upload_actor_authorized_qc026(uuid);
drop function public.adp_upload_intent_guard_qc026();
commit;
