# ADP Release 1.2.1 — Build recovery and verification

Date: 2026-10-30. Recommendation: suitable for an isolated disposable-database rehearsal; not production-ready. No configured Supabase project was accessed, no remote migrations were executed, and nothing was deployed.

## Pre-commit follow-up

The GitHub preparation review found malformed dollar quoting in the unapplied migration 008 and R1.2.1 enable script. They were corrected before commit. SQL quote-balance lint now runs in npm test; this is not a PostgreSQL parser or execution test. The preservation rehearsal runner now supplies the fixture opt-in in the same psql connection. Database and browser verification remain unexecuted.

## Classification

| Area | Classification | Evidence / limitation |
|---|---|---|
| Workspace-root warning | Verified | Repository file-tracing root explicitly configured; warning disappeared. Parent lockfiles were not changed. |
| Production build outside sandbox | Verified | Complete builds exited 0, including compilation, type validation, page generation and build tracing. |
| Builds inside Windows sandbox | Failed | Repeated EPERM mkdir errors under .next, including after cleanup. |
| Exact Windows denial mechanism | Partially implemented investigation | No visible Node process remained during probes; direct mkdir probes worked. CIM process command-line inspection was denied. Worker disabling did not fix the failure and was reverted. Filesystem security/sandbox interaction is supported by the unrestricted comparison; no particular lock holder or ACL defect was established. |
| Node unit / mocked-route tests | Verified | 19 tests passed. These do not establish database or browser correctness. |
| TypeScript | Verified | Final npm run typecheck exited 0. |
| Migration 008 source corrections | Implemented but unverified | Reviewed and corrected in place because 008 remains unapplied. Requires real PostgreSQL execution and effective ACL inspection. |
| PostgreSQL / concurrency / migration preservation | Implemented but unverified | Fixtures adapted and new tests/rehearsal runner added. No local PostgreSQL/Supabase/Docker installation available. |
| React player integration harness | Implemented but unverified | Uses actual VideoPlayer and its queue with synthetic media and HTTP responses. Browser could not reach local server; shell loopback request was denied by socket permissions. |
| Authenticated Supabase/Mux playback | Implemented but unverified | Not performed. |

## Build investigation and changes

The existing repository lockfile and a parent-directory package-lock.json caused Next to infer the parent workspace root. next.config.ts now pins outputFileTracingRoot to the repository. No parent files were edited or deleted.

The generated .next directory was checked for its exact resolved location and absence of a link before cleanup. A fresh build succeeded, while later sandbox builds still failed. Direct Node mkdir probes against the reported directories succeeded. A webpackBuildWorker=false experiment failed and was removed. No permissions or ACLs were weakened.

scripts/build.mjs now provides an exclusive build lock and validates/removes only the reserved generated .next directory. Development uses .next-dev to avoid sharing output with production builds. The lock prevents overlapping npm builds; it is not a claim to detect every external process. A crashed build can leave a lock requiring operator review.

The same local build command completed outside the sandbox. This recovers the build using an unrestricted local terminal, but the exact low-level Windows EPERM mechanism remains unresolved; successful builds must not erase the recorded sandbox failures.

## Migration 008 source review

1. Asset binding: new intervals and sessions use asset ID, stored numeric(12,3) duration, and validator 12. Current coverage filters require matching binding, release_1_2 provenance, no reset_at marker, and completion eligibility. Changing an asset ID or duration cannot reuse a different identity's intervals. Schema/API readiness uses 121 separately from validator version 12.
2. Historical/unbound evidence: migration 008 does not infer bindings. Old intervals and completion records remain stored. The derived verified_watched_seconds cache is zeroed until current bound evidence is recorded. Unverified-duration playback creates no reusable bound evidence; later synchronization cannot promote it.
3. Completion dates: completed_at remains intact. New or renewed verified completion records verified_at separately; reset_at excludes retired completion. Member/admin summaries check the exact current identity. A full newly verified chain is required before an unbound same-key completion can acquire a binding.
4. Interval updates: the trigger rejects changes to user_id, video_id, provenance, identity, boundaries and eligibility. Authenticated users have SELECT only, RLS write policies are absent, and ordinary member writes remain denied. Trusted owners/service operations are not treated as hostile database owners.
5. SECURITY DEFINER: functions use public,pg_temp search paths; preflight refuses untrusted CREATE access to public or ownership of playback definer functions by roles reachable from anon/authenticated. Internal validator/refresh EXECUTE grants are scrubbed, including custom direct defaults. Actual effective project role memberships and ownership remain unverified.
6. Receipts: duplicate lookup precedes asset/session-state conflict handling. The full R12 result is saved as the request receipt, so retry returns the original decision rather than recomputing completion. Current version/position/state are reported separately. Inactive-session duplicate responses cannot reactivate the React player or restore reset progress.
7. Asset mismatch: a validly addressed mismatch gets a durable asset_version_changed rejection and permanently retires that session. Stored evidence/budget is not promoted or consumed by the rejected advancement. Invalid request shapes do not create this transition.
8. Resets: adp_admin_progress authenticates whitelist/admin privileges and takes the user/video advisory lock used by session creation. It locks matching sessions before retiring intervals and current completion. Sessions are deactivated and their versions advanced. A concurrent heartbeat commits first and its evidence is retired, or waits and then sees an inactive session. The test for this ordering is implemented but not executed.
9. Overrides: completion_records insertion and admin_audit_log insertion occur in the same SQL function invocation. An audit exception rolls back the override statement. Existing historical records are preserved by ON CONFLICT DO NOTHING. Overrides never write verified_completion_records.
10. Duration sync: service_role only; checks maintenance, valid positive millisecond duration, and video existence. It updates metadata and refreshes only matching identity coverage without rewriting interval provenance/eligibility. Metadata updates and audit insertion are atomic. Mux readiness/signature validation remains in the server helper; only its mocked tests have executed.
11. Historical completion pollution: the internal heartbeat validator no longer inserts completion_records or generates a new historical completed_at. R12 verification is stored separately.
12. Readiness/permissions: adp_playback_integrity_version returns no ready API when playback control is off. 008 ends with control disabled and marker 121. The new enable script verifies readiness and scrubs direct grants before restoring only authenticated R12/admin execution and service_role duration sync. Legacy/internal RPCs remain revoked. Function owners remain trusted; custom dependent grant chains require operator review.

008 has explicit BEGIN/COMMIT and a five-second lock timeout. The migration preserves raw history but performs table/row updates and DDL that can block; duration and locks must be measured on a disposable clone. If another installation already applied an earlier 008, do not overwrite its history: prepare a forward migration instead.

## Additional player defects corrected

- The response was truncated to 1,600 characters before JSON parsing. Large interval receipts could become invalid JSON and appear rejected despite a successful save. The entire response now parses; only diagnostic text is truncated. Unparseable responses retain an unknown transport outcome and retry the same request ID.
- Rejection of an older pending transport retry could discard a queued newer resume. The queue now continues to that newer intent while retaining request identity/version handling.
- Delayed stop recovery uses the original request's intent generation. A newer play intent suppresses recovery of an older pause/buffering event.
- A receipt for a reset/replaced inactive session cannot resume the component. An old duplicate completion cannot display a fresh completion claim over a newer session version.

## Regression files

- supabase/tests/progress_integrity.sql: adapted asset-bound fixtures and fixed nonexistent session_id joins; unbound-duration expectations no longer assume promotion. Includes real database-clock continuous playback, gap, budget, ordering and expiry cases.
- supabase/tests/release_1_2_1.sql: actual validator completion; same-duration asset replacement; longer/shorter durations; preserved completion dates; receipt-backed asset mismatch; legacy seeks; conflicting duplicate payloads; reset and duplicate-after-reset; provenance/RLS rejection; injected audit failure and rollback; distinct overrides; database maintenance gates.
- supabase/tests/release_1_2_1_concurrency.mjs: separate psql transactions for in-flight heartbeat/reset and pause/resume competition. Requires an opted-in loopback target.
- supabase/tests/progress_integrity_concurrency.py: binding-aware fixtures; Python syntax compiled successfully. Its database operations were not executed.
- supabase/tests/progress_integrity_migration_after.sql: fixed invalid public.auth.users cleanup. Preservation checks remain database-only and unexecuted.
- supabase/tests/rehearse_release_1_2_1.ps1: local-only clean install, pre-005 history, deliberate 008 transaction failure/rollback, retry, preservation, SQL assertions, concurrent tests and enable/disable repetition. Its PowerShell syntax was checked; its SQL operations were not executed.
- supabase/tests/maintenance_routes.test.mjs: executes actual route handlers compiled from TypeScript, with mocked auth/database/Mux dependencies. Admin GET/POST and member session/heartbeat fail closed with either gate.
- supabase/tests/heartbeat_response.test.mjs: complete large-receipt parsing and unparseable-response handling.
- supabase/tests/player_lifecycle.test.mjs: event mapping, intent-generation recovery, historical status, exact asset identity, and reset/unbound completion exclusion.
- src/app/dev/player-regression/page.tsx and harness.tsx: actual React player queue with a synthetic media adapter and intercepted fetch responses. Pause/buffering modes and ?lostResponse=1. Production route returns not-found.

## Commands actually executed

| Command / action | Result |
|---|---|
| git status --short; git diff --check | Preserved prior candidate changes; no whitespace errors. |
| Process / ACL / filesystem probes | CIM access denied; no Node process listed by Get-Process at inspection; mkdir probes succeeded. No ACL changes made. |
| npm test | 19 passed: lifecycle/status 5, duration-sync 9, maintenance routes 2, response parsing 2, SQL delimiter lint 1. Mux/database dependencies in the relevant suites are mocked. |
| npm run test:player-lifecycle | Passed, including final five-test suite. |
| npm run test:duration-sync | Nine passed; mocks only. |
| npm run test:maintenance | Two passed; route execution with mocked services. |
| npm run test:heartbeat-response | Two passed. |
| npm run typecheck | Passed on final source. |
| npm run build (sandbox) | Multiple attempts failed with EPERM, even after cleanup and with worker experiment. |
| npm run build (unrestricted local execution) | Full production builds completed. Final reviewed source built successfully. |
| node --check scripts/build.mjs and new .mjs test files | Passed syntax checks. |
| Bundled Python -m py_compile supabase/tests/progress_integrity_concurrency.py | Passed syntax check only. |
| PowerShell Parser.ParseFile for rehearsal script | Passed syntax check only. |
| npm run test:release-concurrency | Refused to run: no opted-in disposable loopback database. No database connection occurred. |
| npm run dev -- --hostname 127.0.0.1 --port 4178 | Server started; stopped after browser attempt. |
| Browser open of local React harness | Failed: ERR_CONNECTION_TIMED_OUT. |
| Invoke-WebRequest to same loopback URL | Failed: socket access permissions denied. |

## Changed files and deployment order

Build/configuration: .gitignore, next.config.ts, package.json, scripts/build.mjs.
Application: src/components/video-player.tsx, admin-dashboard.tsx; src/lib/player-lifecycle.mjs and declaration, progress-status.mjs and declaration, heartbeat-response.mjs and declaration; admin API, heartbeat/session APIs, library and video page; development React harness.
Database/deployment: unapplied migration 202610300008_release_1_2_1_integrity.sql; release_1_2_1 capture/disable/enable SQL and RELEASE_1_2_1.md. Applied migrations 001–007 were not edited.
Tests: files listed above. The initial worktree already contained Release 1.2.1 candidate modifications; they were retained.

Apply missing migrations in filename order, ending with 008. Keep all member/admin traffic blocked and PLAYBACK_HEARTBEATS_ENABLED=false. Use the new narrow disable before the window and after 005/006 if applying them, since they restore old grants. Capture actual ACLs and preserve a restorable snapshot. On failure leave gates off, inspect committed schema/ledger, and repair forward; never assume an automatic downgrade. After 008 verify marker 121, control off, history preserved, bindings unpromoted, RLS/grants and function ownership. Execute the disposable suites and failure rehearsal, then the new enable script. Restore only reviewed integration grants. Use matching app code and verify Mux synchronization under admin-only host access before admitting members.

## Outstanding acceptance work

No PostgreSQL, Supabase CLI, Docker, or PostgreSQL server binary was found. A bundled Python runtime exists but does not supply a database. Database tests, true concurrent transactions, migration preservation, effective permissions, rollback/failure recovery and ACL restoration behavior have not executed. A plain PostgreSQL instance also needs Supabase-compatible auth schema, roles and helper functions; empty PostgreSQL alone is insufficient.

The browser transport boundary prevented running the React harness; its compilation is not evidence of a passed integration test. Actual Mux rendering, Discord authentication, server/client convergence and full completion require authenticated staging tests.

Use the operator commands in supabase/deployment/RELEASE_1_2_1.md. The rehearsal requires an EMPTY disposable local Supabase instance, psql and Supabase CLI; it rejects a non-loopback target and requires explicit ADP_ALLOW_LOCAL_DB_TEST=1. No test should use configured remote project credentials.

The server accounting limits claims to database-observed client-declared active time. It does not prove media rendering or attention.
