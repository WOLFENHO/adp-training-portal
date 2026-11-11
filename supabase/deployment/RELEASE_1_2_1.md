Release 1.2.1 verification candidate — not production approved

Migration 008 is unapplied. It was corrected in place because it has never been approved or applied to the configured project. Do not edit or rerun migrations 001–007 on an existing installation. If any other installation already applied 008, use a reviewed forward migration instead.

New evidence uses immutable asset ID + numeric(12,3) duration + validator 12 identity. Schema/API readiness is 121. Existing unbound intervals and completions are retained and cannot be promoted by synchronization. Unverified-duration playback is allowed but its unbound intervals cannot become verified later: fresh playback after metadata verification is required. Historical completed_at dates remain unchanged; renewed verified completion uses verified_at. Resets retire intervals/completion evidence with reset_at and invalidate/advance sessions atomically. Overrides and audit insertion share one database transaction.

Migration source corrections include receipt handling before session-version checks, storage of the full R12 receipt, immutable user/video ownership on interval updates, explicit internal RPC ACL scrubbing, trusted function ownership/schema preflight, and readiness that fails closed while playback control is disabled. The internal validator no longer creates historical completion records. Duration synchronization preserves interval evidence and recalculates only matching bound coverage, with an atomic audit insert.

Deployment sequence:
1. Rehearse only on an empty disposable local Supabase database with its standard auth schema/roles. Inventory custom grants, role memberships, function owners and public-schema CREATE privileges. Capture release_1_2_1_capture_playback_acl.sql output and take a restorable snapshot.
2. Block ALL application and admin traffic; set PLAYBACK_HEARTBEATS_ENABLED=false. Run release_1_2_1_disable_playback.sql. It is narrow to ADP RPCs; it does not revoke schema USAGE. Owner privileges remain trusted. Capture is evidence, not an automatic restoration script.
3. For fresh installations apply filenames in order: 202610290001_init.sql, 202610300001 through 202610300004, 005, 006, 007, then 008. Re-run the narrow disable script after 005 and 006 because those migrations grant legacy RPC access. Existing installations apply only missing migrations.
4. Apply 008 with ON_ERROR_STOP. It has explicit BEGIN/COMMIT and a 5s lock timeout. It updates session and derived verified-progress state, and takes DDL/table locks: assess row count and maintenance duration on the disposable clone.
5. On failure keep both application and database gates off. Re-run the narrow disable script, inspect migration ledger and actual columns/functions/ACLs before forward recovery. If 008 rolls back, the database remains at 007 and the separate disable remains effective. Do not route the old app or blindly rerun partially executed SQL. A runner that splits transactions must not be used.
6. Check preserved historical IDs/dates, null bindings on pre-008 evidence, session invalidation, marker 121, immutable trigger, RLS and effective grants. Execute database regressions, real concurrent tests and failure/rollback rehearsal before approval.
7. Use release_1_2_1_enable_playback.sql only after postflight. It restores R12/admin RPCs to authenticated and duration sync only to service_role; old/internal RPC access stays revoked. Custom playback grants are NOT automatically restored. Enable itself is transactional and may CASCADE dependent grants on the listed functions; review the captured grant chain first.
8. Route matching application/admin code behind host maintenance, then permit admin metadata synchronization after both gates are enabled. Keep member traffic blocked until per-video Mux failures are reviewed. Unverified published videos cannot earn current verified completion. Remove host maintenance only after authenticated staging playback checks.

Tests implemented:
- progress_integrity.sql: adapted asset bindings, schema joins, and unbound-duration expectations. Three-minute database-clock continuous playback remains a real PostgreSQL test.
- release_1_2_1.sql: actual validator completion, equal/longer/shorter asset changes, historical completion preservation, legacy seek rejection, conflicting request IDs, reset and duplicate-after-reset, provenance/RLS rejection, audit failure injection/rollback, admin override distinction, and maintenance.
- release_1_2_1_concurrency.mjs: independent psql transactions for heartbeat/reset overlap and concurrent pause/resume. Refuses a non-loopback URL and requires explicit disposable-test opt-in.
- progress_integrity_migration_before.sql / after.sql: before-005 history snapshot and after-008 preservation; corrected auth.users cleanup.
- rehearse_release_1_2_1.ps1: clean local installation, injected 008 failure and rollback checks, retry, preservation, enable/disable idempotency and regressions. Requires psql and Supabase CLI; unexecuted here.
- maintenance_routes.test.mjs: executes actual compiled route handlers with mocked authorization/database/Mux dependencies. Covers admin GET/POST and member heartbeat/session gates.
- heartbeat_response.test.mjs: complete parsing of large server receipts with bounded diagnostic logging, and retry handling for unparseable responses.
- /dev/player-regression: actual React VideoPlayer/queue with synthetic media and HTTP transport. Development only; production returns not-found. Pause and buffering modes, with ?lostResponse=1 for retry after response loss. This is NOT Mux or database playback verification.

Disposable execution (operator must confirm the target is empty/local):
  supabase start
  # Use the local database URL; never use configured remote credentials.
  $env:ADP_ALLOW_LOCAL_DB_TEST='1'
  ./supabase/tests/rehearse_release_1_2_1.ps1 -DatabaseUrl '<disposable loopback PostgreSQL URL>'
  # The rehearsal runner includes deliberate failing SQL and must recover before reporting success.

Browser execution:
  npm run dev -- --hostname 127.0.0.1 --port 4178
  Open http://127.0.0.1:4178/dev/player-regression and test both modes.
  Repeat with ?lostResponse=1. Require a PASS with no new stop request ID after resume.

Local checks:
  npm test
  npm run typecheck
  npm run build
Build uses a guarded .next-only cleanup and an exclusive lock. Development output is .next-dev; parent lockfiles are unchanged. Do not delete a stale .adp-build.lock without checking for a running build. Sandbox EPERM may still require an ordinary unsandboxed terminal build; no application permission weakening is configured.

Remaining acceptance blockers: PostgreSQL suites/ACL and function inspection, actual concurrent transactions, migration/failure rehearsal, React harness execution, and authenticated Supabase/Mux staging playback. Source review and mocked tests do not prove database or browser correctness. The server budget bounds client-declared active-time claims using database time; it cannot prove rendering or attention.
