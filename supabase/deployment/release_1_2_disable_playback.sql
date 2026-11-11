-- Run as the database owner during the migration window. This is deliberately
-- limited to ADP playback functions; it does not change public schema, table,
-- Storage, Realtime, or unrelated API grants.
begin;
set local lock_timeout='5s';
do $$
declare
  signature text;
  target regprocedure;
  grantee record;
  signatures text[]:=array[
    'public.start_playback_session(uuid)',
    'public.record_playback_heartbeat(uuid,numeric,boolean)',
    'public.record_playback_heartbeat(uuid,uuid,bigint,bigint,numeric,boolean,text)',
    'public.start_playback_session_r11(uuid)',
    'public.record_playback_heartbeat_r11(uuid,uuid,bigint,bigint,numeric,boolean,text)',
    'public.start_playback_session_r12(uuid)',
    'public.record_playback_heartbeat_r12(uuid,uuid,bigint,bigint,numeric,boolean,text)'
  ];
begin
  if to_regclass('public.adp_playback_control') is not null then
    execute 'update public.adp_playback_control set enabled=false,updated_at=clock_timestamp() where singleton';
  end if;
  foreach signature in array signatures loop
    target:=to_regprocedure(signature);
    if target is null then continue; end if;
    for grantee in
      select distinct a.grantee,a.privilege_type
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=target and a.privilege_type='EXECUTE' and a.grantee<>p.proowner
    loop
      if grantee.grantee=0 then
        execute format('revoke execute on function %s from public cascade',target);
      else
        execute format('revoke execute on function %s from %I cascade',target,pg_get_userbyid(grantee.grantee));
      end if;
    end loop;
  end loop;
end $$;
commit;
