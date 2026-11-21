# Gold release candidate: evidence and execution boundaries

Source baseline: Version 12, GitHub `main` at `8dd0e507830a5aa11e7ada3dd7a24e68b419de95`. This local candidate has not been published or deployed.

## Current evidence

- Version 12 Production smoke checks passed with maintenance enabled: admin paging, whitelist/library, rejected invalid cursor, upload POST 503, playback token/session 503 and no token. Production training records are preserved.
- QC-005 valid/revoked admin rollback-only database authorization passed. Its proposed grant change and direct Data API roles are pending.
- QC-026 v3 rollback-only PostgreSQL assertions passed on November 18 with SHA-256 `1138371d78d620b73356a6f8bd4e87e63d5a789c5cf80c3bec1e21ae410d8609`; one permitted audit sequence allocation was observed. This does not establish Data API, two-connection, or provider behavior.
- The subsequent authorized Rehearsal window stopped before installation because a secure disposable Auth/Data API channel was unavailable. No candidate objects or fixtures were installed in that attempt.
- Offline tests use mocked media/provider requests. They do not establish live browser, Supabase, or Mux acceptance.

## Source and SQL order

1. Keep `ADP_UPLOADS_ENABLED` unset/false and `PLAYBACK_HEARTBEATS_ENABLED=false` on any deployment until separate activation approval. The upload gate also requires `ADP_UPLOADS_PROJECT_REF` to match the exact Supabase URL hostname. Set the project reference only for the intended environment during an authorized activation.
2. Capture fresh baseline objects/ACLs and a restorable logical backup. Verify project identity, Release 121 definitions, maintenance controls, protected records, Preview isolation, active sessions, and version of the reviewed SQL.
3. Install `supabase/batch3/qc026_upload_intents_candidate.sql` (SHA-256 `e4a578db2bf5d3e524be1aac49a0e24d30feb7b25a05f52c07ad61df853b3a77`) before `supabase/batch3/qc026_reconcile_extension.sql`. The extension adds recovered-target binding and first-upload metadata verification; both need independent authorization and live ACL/state-transition tests. The prior v3 acceptance remains valid for the unchanged five base RPC bodies. Install the separate `supabase/batch3/gold_training_sequence_candidate.sql` only after confirming Release 121, old playback RPC ACLs, maintenance mode and no active sessions. It gates direct token, session and heartbeat access using the current asset-bound verified completion of every preceding published module.
4. Verify `PUBLIC`, `anon`, and `authenticated` cannot execute any QC-026 helper or provider-binding RPC; `service_role` can execute the seven external RPCs and cannot DELETE intents directly. Verify the server rechecks current administrator and whitelist access before provider calls.
5. Run a single Rehearsal acceptance window: disposable Auth identities and Data API permission matrix, two independent PostgreSQL connection races, one disposable Mux direct upload and failure/recovery, protected browser auth/playback/retry/anti-skip/completion. Distinguish application gate approval from SQL installation approval. Capture sanitized response/record identities and state counts.
6. Activation requires the approved project-scoped upload flag, provider credentials, SQL installation, and Mux metadata flag. The extension verifies first uploads only when unpublished and free of any playback/progress/completion history. Legacy duration changes retain their maintenance-only path. Both paths need live acceptance before activation.

## Stop conditions and recovery

Stop before Production promotion on permission mismatch, credential/project mismatch, duplicate provider uploads, non-atomic binding, an unexpected database write, failed completion/anti-skip, or failed restore readiness. Do not remove provider assets automatically. Preserve an ambiguous upload for manual reconciliation.

Application rollback: route Production traffic to the prior Version 12 deployment. Keep both upload/playback flags OFF. Revert the Git source separately after traffic is stable. SQL rollback is independent: while uploads remain OFF, snapshot and verify no remaining intent references, then remove the extension function explicitly and use the reviewed base QC-026 cleanup without CASCADE. If intent rows or provider uploads exist, retain objects and perform a targeted, reviewed reconciliation; preserve training history. Never delete an asset as part of this rollback.

Outstanding: direct Data API permission proof, two-connection races, live first-upload metadata verification, real Mux recovery, authenticated browser playback and verified completion on Vercel, live sequential training policy enforcement, Production schema parity and restore confirmation. Gold activation remains NO-GO until critical paths pass. The progression implementation is offline tested only. A separate staged acceptance runbook is in `docs/GOLD-rehearsal-acceptance.md`.
