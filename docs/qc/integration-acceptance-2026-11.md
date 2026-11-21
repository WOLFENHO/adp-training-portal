# ADP controlled integration acceptance package

The independently authorizable execution boundaries are in [integration-authorization-tracks.md](integration-authorization-tracks.md). This document retains the full test and operational matrix.

Candidates: application `498773a7392eaed94bd3f86814919e3c69efa6ae`; SQL `ecab89bd47e7132daa50610cf03539c7ef3cb037`. Keep these refs separate. This package is preparation only. Production baseline remains `22481bcac2de4f53edddc7508814e555d54d61fe`.

## Observed environment and boundary

On 2026-11-15, the Supabase connector reported ADP-Rehearsal `nqqarmkgnuvvqnvnodyc` ACTIVE_HEALTHY, PostgreSQL 17.11, database host `db.nqqarmkgnuvvqnvnodyc.supabase.co`, 14 public tables, 18 public functions, ten migration ledger entries and zero videos/profiles; the whitelist and administrator tables each have one row. Production ADP Portal `ebwtainwlgruoglyckui` is a different ACTIVE_HEALTHY project at a different host. The rehearsal project is an existing shared service, so disposable ownership of all its records and credentials is not established by its name or empty profile count. No test writes were run.

Vercel metadata lists `audit/qc-batch1-isolated` Preview overrides for Supabase URL, anon key, service-role key and expected project reference, plus playback and Mux control flags. Shared Preview variables also exist. Their effective flag values, encrypted values and deployed service-role identity were not independently established in this preflight. The project has SSO protection enabled; no new audit deployment appears in the latest deployment list, whose newest entries are older QC-014 attempts. The connector's project summary does not expose the automatic Preview pause setting, so the pause is inherited from prior operator confirmation, not independently reverified here. Do not resume automatic Previews. A protected read-only credential identity proof remains the QC-014 gate. Static project-ref checks cannot prove a credential's actual project.

Mux credentials and signing-key state were not read. Existing Mux provider calls and browser access need a disposable test asset and protected test identity. Never report that the provider or browser suite passed from mocked tests.

## Gate order and executable commands

| Gate | Action | Evidence and stop condition |
| --- | --- | --- |
| 0 | Pin both candidate SHAs; confirm `main` baseline, no unexpected deployments, Preview pause, SSO and unchanged Production/Sites fallback. | Stop on ref drift or any unapproved deployment. |
| 1 | Independently prove the effective branch service-role credential is accepted by rehearsal through a protected read-only probe, with missing/mismatched config failing before a privileged query. | QC-014 pass with sanitized ref and code, no secret or record contents. If protected HTTP access remains unavailable, leave blocked and proceed with offline work. |
| 2 | Obtain explicit disposable ownership of a separate database or transaction-scoped fixture namespace. Run `node scripts/qc-integration-preflight.mjs` with `ADP_QC_EXPECTED_REF=nqqarmkgnuvvqnvnodyc` and a protected `ADP_QC_DATABASE_URL` environment setting. Store the sanitized JSON locally, compare function, owner, ACL, RLS, trigger and release fingerprints to captured Release 121 and a fresh authoritative read-only snapshot. | Tool rejects any other host/ref before connecting. Stop on missing objects, role or fingerprint mismatch. Never paste connection strings. A matching URL alone is not independent credential proof. |
| 3 | Only on the verified disposable target, stage isolated QC-003/013/026 SQL candidates. Use `adp.qc_isolated=confirmed-nonproduction`; run rollback-only fixtures `supabase/batch2/qc003_gap_rehearsal.sql`, `qc013_role_matrix_rehearsal.sql`, and `supabase/batch3/qc026_terminal_rehearsal.sql` via `psql -X -v ON_ERROR_STOP=1 -f <file>` in separate controlled sessions. Inspect SQL before each run, fingerprint after rollback, compare row counts. | Every assertion passes; no residual rows or definition drift. The marker is a guard, not proof of isolation. Do not run against Production. QC-003 20-second threshold remains provisional. |
| 4 | Use disposable committed intent for `qc026_concurrency_a.sql` and `_b.sql` in two sessions; use isolated role JWTs for direct Data API and RPC matrix. Test valid/revoked admin/member/anon and wrong owner, plus duplicate heartbeat and concurrent claims. | One claim, correct per-request authorization, atomic audit; no surviving fixture except explicitly disposable setup. Restore from snapshot if rollback check fails. |
| 5 | Run pagination and completion-only queries on isolated rows; test 0, 1, 20, 50, 51 and large data sets, revoked admin between pages, cross-admin/tampered/key-rotated cursor, concurrent insert/delete, long text and size cap. | No missing historical or verified completion, even without progress; no unauthorized page, bounded response, correct historical/current evidence label. |
| 6 | On protected isolated app with disposable Discord identities and Mux media, run the browser/provider matrix below. | Auth, provider, media and database evidence agree. Stop on unauthorized coverage, incorrect asset binding, duplicate completion, live Production reference or secrets in logs. |
| 7 | Review evidence, maintenance policy, app and SQL rollback independently. | A new approval is required for Preview restoration, merge, Production migration, rotation or playback changes. |

The read-only preflight script uses a PostgreSQL read-only transaction, refuses Production and arbitrary hosts, passes the password through the child environment, and emits catalog fingerprints. It does not authenticate to Vercel or prove branch-effective service-role identity. Do not store its output with user records. Fixtures must be executed only after independent project and disposable-fixture confirmation.

## Coverage and evidence matrix

| Area | Existing evidence | Remaining acceptance |
| --- | --- | --- |
| App/SQL candidate static and mocked suite | 115 combined tests, typecheck/build, separate final GitHub Actions succeeded | Integration behavior unexecuted. |
| QC-002/005 | Prepared role matrix and captured definitions | Disposable direct Data API/RPC matrix including revoked admin and grants. |
| QC-003/006/013 | Static SQL tests and rollback-only scripts | Fresh function/owner/ACL/RLS/trigger comparison, upgrade convergence, concurrent heartbeat and audit failure injection. |
| QC-014 | Branch-scoped variable names, SSO metadata and fail-closed mocked tests | Effective protected service-role identity and automatic Preview pause setting unverified by available metadata. |
| QC-017 | Cursor tamper, admin binding, size limits, completion-only mock tests | Actual PostgREST query/cursor paging, historical versus verified records, accessibility. Configure dedicated server-only secret only in isolated test. |
| QC-026 | Terminal-binding mock tests and executable SQL fixtures | SQL runtime, two-session lock, provider lost response/ambiguous upload, exact asset identity, rollback and manual orphan review. |
| Browser/Mux | Player lifecycle and network-adapter mocked tests | Authenticated protected browser and signed disposable asset tests unexecuted. |

## Coordinated browser and provider matrix

Disposable admin, revoked admin, member and unauthorized accounts; a short signed disposable Mux asset and comparison asset. Capture correlation IDs, request/response status, redacted server logs, database receipt and verified-completion counts. Never log JWTs, URLs, headers or raw user records.

1. OAuth login and refresh, expired and revoked sessions; whitelist and administrator navigation under both roles.
2. Player start, pause, reload, lost response retry, duplicate receipt, overlapping intents and session expiry; compare accepted heartbeat position with database intervals.
3. Deny forward seek; early end yields no completion; continuous eligible playback yields one verified completion and correct UI/admin status.
4. Signed-token expiry and maintenance: disabled DB switch then app switch blocks new issuance/credit; observe already issued token through its expiry in isolation.
5. Admin pagination, cursor replay, completion without progress, revoke between pages, keyboard focus and screen-reader labels.
6. Upload creation loss, timeout, lease/URL expiry, ambiguous provider response, exact upload/asset/playback binding and manual orphan identification. No automatic provider deletion.
7. Browser widths and input modes: keyboard, fullscreen, focus recovery, reduced motion and assistive announcement of errors.

Automated local unit tests and direct isolated SQL can run without a protected deployment after isolation. OAuth, actual playback, signed token and UI accessibility need protected authenticated browser access. Provider response recovery needs disposable Mux access. Do not access Production playback resources.

## Operational stop and rollback

- **QC-001 signing key:** Inventory key ID, all Production and Sites issuers, active signed token TTLs and disposable-key test. Prepare replacement for both issuers, validate before cutover, keep old key only for bounded overlap, then retire it. A rollback to the disclosed key is unsafe; rollback means disable new playback and restore a newly protected known-good key, subject to separate authorization. Existing tokens may remain valid until expiry or provider revocation.
- **QC-014 isolation:** Keep automatic Previews paused. Verify branch scopes and SSO, prove service role against the exact rehearsal project read-only, reject wrong/missing settings, inspect deployment identity. A failed proof stops Preview privileged operations; restore pause after a separately authorized window. Existing READY QC-014 Preview requires separate cleanup decision.
- **QC-022 receipts:** Inventory deployed cleanup function and age/counts; propose bounded batch with grace after 12-hour session expiry, dry-run counts, active-session exclusion and monitoring. Preserve intervals, progress and completion. Do not schedule the existing 12-hour cleanup unchanged.
- **QC-024 media shutdown:** DB playback switch off first, app switch off second; verify issuance and heartbeat denial. Previously signed Mux bearer URLs remain accessible until expiry unless provider-level revocation is separately authorized. Emergency revocation may affect Sites fallback; record affected assets and token TTL.
- **Application rollback:** Revert only app candidate commits from its own branch after capturing deployed commit and page/API evidence. Cursor-secret absence deliberately denies admin paging; prepare the isolated secret before enabling the page. QC-004 unpublish-only physical deletion stays enforced.
- **SQL rollback:** Retain captured exact function definitions, owner/ACL/grant fingerprints and pre-change snapshots. Revert each approved SQL batch in reverse dependency order within a transaction, verify fingerprints and unchanged history. Never delete provider assets or existing progress/completions. QC-026 table cleanup requires proving no active intent; retain ambiguous records for manual reconciliation.

## Decisions and readiness

**No-go for isolated mutation and protected browser testing today.** The rehearsal project is distinct, but disposable ownership, fresh deployed fingerprint match and effective Preview service-role identity are not proven. Read-only catalog preflight and local automation can proceed independently. The smallest operator approval session is: authorize a disposable isolated database/fixture namespace and a protected, read-only QC-014 verification window once its exact target, pause control and expected sanitized result are reviewed. A later, separate session decides key rotation, Preview restoration and any promotion. No actual secret is requested by this package.
