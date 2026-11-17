# Consolidated candidate dependency order (review only)

No SQL here is approved for Production. Keep the application and SQL rollback boundaries separate.

1. On a verified disposable, empty Supabase target, apply the nine `supabase/migrations/*.sql` files in filename order. Never replay these onto Production. Compare the resulting definitions, owners, ACLs, RLS, indexes and triggers to the captured Release 121 evidence; current Production parity remains unverified.
2. Verify the current target definition and owner of `adp_admin_progress(uuid,uuid,text)` and supply its freshly captured `md5(pg_get_functiondef(...))` only to the same verified target session. Run `batch1/qc005_grant_candidate.sql`; missing or mismatched fingerprints abort the transaction. Do not use a repository-derived hash as evidence of a deployed target.
3. Review and test `batch1/qc002_candidate.sql` with `batch1/qc002_authorization_matrix.sql` in rollback-only isolation. Its changed `is_administrator()` definition must precede QC-026's actor checks and the direct Data API role matrix.
4. Separately compare deployed `r11` and `r12` functions, then rehearse `batch2/qc003_gap_candidate.sql` and `batch2/qc013_atomic_video_update_candidate.sql` with their rollback-only fixtures. These are independent of QC-026 and remain isolated.
5. Apply `batch3/qc026_upload_intents_candidate.sql` only after baseline `profiles`, `authorized_discord_ids`, `administrator_roles`, `videos`, and `admin_audit_log` objects and their identities match the verified target. In the same transaction it creates the table, guard, RLS, helper, five RPCs, and explicit service-role-only EXECUTE grants. Run role, terminal-state and two-connection fixtures before enabling the application caller.
6. Deploy the compatible application only after the SQL and direct Data API matrix pass. An unresolved Mux response always requires manual reconciliation; no retry may create another upload for that operation.

The live QC-005 target fingerprint has not been independently obtained. Direct Data API, concurrency and SQL rollback behavior have not been executed in a disposable database. The candidates must remain uninstalled until these gates pass.
