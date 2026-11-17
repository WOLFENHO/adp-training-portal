-- Disposable Release 121 database ONLY; apply qc013 candidate first.
-- Requires session setting adp.qc_isolated='confirmed-nonproduction'.
begin;
do $$begin
 if current_setting('adp.qc_isolated',true) is distinct from 'confirmed-nonproduction' then
   raise exception 'QC rehearsal requires explicit isolated database marker';
 end if;
end $$;
-- This grant exists only inside the rollback transaction; candidate grants nothing.
grant execute on function public.adp_admin_update_video_qc013(uuid,text,text,text,boolean,integer) to authenticated;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select u.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',u.email,'',clock_timestamp(),'{"provider":"discord","providers":["discord"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
from (values
 ('c1000000-0000-4000-8000-000000000001'::uuid,'qc-valid@example.invalid'),
 ('c1000000-0000-4000-8000-000000000002'::uuid,'qc-revoked@example.invalid'),
 ('c1000000-0000-4000-8000-000000000003'::uuid,'qc-member@example.invalid')) u(id,email);
insert into public.profiles(id,discord_id,username) values
 ('c1000000-0000-4000-8000-000000000001','777777777777777771','QC valid'),
 ('c1000000-0000-4000-8000-000000000002','777777777777777772','QC revoked'),
 ('c1000000-0000-4000-8000-000000000003','777777777777777773','QC member');
insert into public.authorized_discord_ids(discord_id,added_by) values('777777777777777771','qc fixture'),('777777777777777773','qc fixture');
insert into public.administrator_roles(discord_id,granted_by) values('777777777777777771','qc fixture'),('777777777777777772','qc fixture');
insert into public.videos(id,title,description,published,duration_seconds) values('c2000000-0000-4000-8000-000000000001','Original','QC fixture',false,0);
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
do $$begin
 if public.adp_admin_update_video_qc013('c2000000-0000-4000-8000-000000000001','Allowed','QC fixture',null,false,1)->>'ok' is distinct from 'true' then raise exception 'valid admin rejected'; end if;
end $$;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
do $$declare denied boolean:=false; begin
 begin perform public.adp_admin_update_video_qc013('c2000000-0000-4000-8000-000000000001','Revoked','QC fixture',null,false,2);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'revoked admin accepted'; end if;
end $$;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
do $$declare denied boolean:=false; begin
 begin perform public.adp_admin_update_video_qc013('c2000000-0000-4000-8000-000000000001','Member','QC fixture',null,false,2);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'member accepted'; end if;
end $$;
reset role;
set local role anon;
do $$declare denied boolean:=false; begin
 begin perform public.adp_admin_update_video_qc013('c2000000-0000-4000-8000-000000000001','Anonymous','QC fixture',null,false,2);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous execution accepted'; end if;
end $$;
reset role;
alter table public.admin_audit_log add constraint qc013_rehearsal_audit_failure check (action<>'video-update') not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
do $$declare failed boolean:=false; begin
 begin perform public.adp_admin_update_video_qc013('c2000000-0000-4000-8000-000000000001','Unlogged','QC fixture',null,false,3);
 exception when check_violation then failed:=true; end;
 if not failed then raise exception 'audit failure did not abort video update'; end if;
end $$;
reset role;
do $$begin
 if (select title from public.videos where id='c2000000-0000-4000-8000-000000000001') is distinct from 'Allowed' or
   (select count(*) from public.admin_audit_log where action='video-update' and details->>'videoId'='c2000000-0000-4000-8000-000000000001')<>1 then
   raise exception 'video update/audit diverged';
 end if;
end $$;
rollback;
