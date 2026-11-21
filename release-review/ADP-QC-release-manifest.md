# ADP audit candidate release manifest — 2026-11-17

Status: NO-GO for branch publication while the Vercel Preview gate remains unresolved. No SQL installation or deployment authorized.

## Exact commit chain

`03f5a7b4c5374ca1f6d243790a709fc279da4069` (SQL candidates) → `1fd30d480f7ff7feea6ac8273fe7c1b83e2158ef` (application consolidation) → `36af9d444f654ccff38fdc0b5405c464c2b45751` (QC-026 grant and provider-binding corrections). GitHub compare reports the last commit two ahead of SQL and one ahead of application, zero behind either. Original branch refs remain unchanged.

Included: nine baseline migrations; batch1 QC-002 and guarded QC-005; batch2 QC-003 and QC-013; batch3 QC-026 table, guard, helper and five RPCs; rollback-only isolated fixtures; application route and tests. The `supabase/batch3/INSTALL_ORDER.md` file records dependencies and the distinction between clean installation and a targeted live upgrade.

## Installation gates and order

1. Verify a disposable Supabase target's independent identity. Clean-install the nine `supabase/migrations/*.sql` files in filename order there only, then compare definition/owner/ACL/RLS/trigger/index fingerprints against captured Release 121 evidence. Never replay baseline files on Production.
2. Capture the actual target `adp_admin_progress(uuid,uuid,text)` definition, owner and ACL. Supply its exact `md5(pg_get_functiondef(...))` in the same verified target session before the QC-005 grant. A missing or mismatched hash aborts the transaction. The Production fingerprint is currently unavailable.
3. Rehearse QC-002 authorization predicate and Data API role matrix. Compare the live definition and preserve its rollback definition before any upgrade.
4. Rehearse QC-003 against the captured heartbeat functions and provisional 20-second gap, then QC-013 atomic administration, including rollback and concurrent transactions. These are independent SQL approvals.
5. Install QC-026 only after baseline profiles, whitelist, administrator roles, videos and audit-log definitions are verified. Its one transaction creates the ledger, immutable trigger, RLS, authorization helper and five SECURITY DEFINER RPCs; it revokes PUBLIC/anon/authenticated EXECUTE and grants those five only to service_role. The helper and trigger functions have no client EXECUTE grant. Exercise the direct Data API role matrix, lease and two-connection tests before enabling the application caller.
6. Validate application deployment configuration and its exact commit before release. Protect Preview and verify credential isolation. Preserve unpublish-only deletion and existing training history.

## Environment prerequisites

Protected, isolated integration target with Release 121 parity; two connections and Auth/Data API roles for direct role tests; disposable Mux asset and identities for provider/browser validation. Production requires reviewed SQL ownership and ACL fingerprints, a recoverable backup and targeted rollback scripts before a separately authorized upgrade. The application needs a protected service-role key, Mux credentials, Supabase Auth redirects, existing playback controls and a dedicated admin cursor secret. No values belong in this manifest.

## Rollback boundaries

Application: revert `36af9d4` and `1fd30d4` independently of SQL only after checking live intents; retain ledger rows and Mux resources for manual reconciliation. QC-026 SQL: restore reviewed functions/ACLs; retain any nonterminal or ambiguous intent and associated video records, and do not drop the ledger while referenced. QC-002/003/005/013: each requires its separately captured prior definition, owner and ACL, rollback verification and record-preservation checks. The nine baseline migrations are never a Production rollback mechanism.

## Evidence and remaining gates

Offline: 128/128 tests passed; TypeScript check passed; Next.js production build passed with local placeholder Supabase values. Mocked/structural tests cannot establish actual Data API ACL behavior, PostgreSQL function ownership, concurrency, or Mux behavior. QC-005 live fingerprint is absent. QC-006 deployed-definition convergence remains unverified. QC-003 threshold is provisional. QC-013 and QC-026 require disposable SQL role/concurrency tests. QC-014 Preview pause and effective credential identity remain unverified. Protected browser and Mux integration remain unexecuted. Previously disclosed Mux signing-key replacement (QC-001) remains a separate operational gate.
