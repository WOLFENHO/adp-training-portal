-- ADP-QC-002. Run only on disposable, isolated Release 121 database.
-- This transaction must roll back even when an assertion fails (use psql -v ON_ERROR_STOP=1).
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
VALUES
 ('00000000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qc-admin@example.invalid','',now(),now()),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qc-member@example.invalid','',now(),now());
INSERT INTO public.profiles (id,discord_id,username) VALUES
 ('00000000-0000-4000-8000-000000000101','qc-admin-001','QC admin'),
 ('00000000-0000-4000-8000-000000000102','qc-member-002','QC member');
INSERT INTO public.authorized_discord_ids(discord_id,added_by) VALUES ('qc-admin-001','qc-fixture'),('qc-member-002','qc-fixture');
INSERT INTO public.administrator_roles(discord_id,granted_by) VALUES ('qc-admin-001','qc-fixture');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
SELECT 'valid admin' AS case_name,public.is_authorized() AS listed,public.is_administrator() AS admin,
 (SELECT count(*) FROM public.authorized_discord_ids) AS readable_whitelist_rows;
RESET ROLE;
DELETE FROM public.authorized_discord_ids WHERE discord_id='qc-admin-001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
SELECT 'revoked admin' AS case_name,public.is_authorized() AS listed,public.is_administrator() AS admin,
 (SELECT count(*) FROM public.authorized_discord_ids) AS readable_whitelist_rows;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
SELECT 'ordinary member' AS case_name,public.is_authorized() AS listed,public.is_administrator() AS admin,
 (SELECT count(*) FROM public.authorized_discord_ids) AS readable_whitelist_rows;
ROLLBACK;
