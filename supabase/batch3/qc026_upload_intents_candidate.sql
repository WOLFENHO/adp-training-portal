-- ISOLATED CANDIDATE ONLY. No production application caller or migration approval.
begin;
create table public.adp_upload_intents (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  video_id uuid not null unique references public.videos(id) on delete restrict,
  state text not null check (state in ('reserved','creating','waiting','uploaded','asset_created','needs_reconciliation','manual_review')),
  mux_upload_id text unique,
  upload_url text,
  url_expires_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((mux_upload_id is null and upload_url is null and url_expires_at is null) or
         (mux_upload_id is not null and upload_url is not null and url_expires_at is not null))
);
create index adp_upload_intents_state_age on public.adp_upload_intents(state,updated_at);
alter table public.adp_upload_intents enable row level security;
revoke all on public.adp_upload_intents from public,anon,authenticated;
-- No client role may read the signed upload URL. Server-side service-role access
-- requires a separate isolated authorization and transaction review.
grant select,insert,update on public.adp_upload_intents to service_role;
commit;
