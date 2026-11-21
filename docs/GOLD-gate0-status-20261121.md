# Gold Gate 0 status — 21 November 2026

## Prepared and preserved

- Exact original commits `57ccb3e53338418604c1bb2117acc4c9b016593e` and `77f6fd0396f4fcf5b79b2e08ff9073214ac456b4` remain ancestors of prepared `e22e7980fd5e97f12bf301cb7e5c2e36b8b3f80d`. The five recorded SQL SHA-256 hashes in `GOLD-acceptance-execution-plan.md` remain unchanged.
- The isolated local branch is `recovery/gold-verified-20261121`. `vercel.json` suppresses automatic Git deployments for it and the existing probe-only branch. No remote recovery branch was created.
- A dedicated read-only `/api/diagnostics/gold-runtime` route is prepared locally with Preview/branch, expiry, token, Rehearsal configuration and disabled-feature gates. It returns only fixed status codes and is disabled until branch-specific secret and bounded expiry settings are deliberately installed. It has not been deployed or invoked.

## Publication constraint

The connected GitHub app can create repository objects but cannot push the existing local Git objects with their original commit IDs. The local shell has no authenticated GitHub CLI or Git credential. Recreating the history with GitHub's commit API would change the exact commit SHAs. Preserve the bundle and publish with an authenticated `git push` from a Git client that can read the full-history bundle. Verify the remote head matches the exact prepared commit after publication. Do not move `main` or the probe-only branch.

## Backup and restore constraint

The connected Supabase interface has no backup export or isolated restore-test capability. The existing projects are ADP-Rehearsal (active), ADP Portal (Production, active) and ADP-Test (inactive and not established as disposable); Rehearsal has no database branches. A fresh Supabase branch was quoted at `0.01344` per hour by the connected cost tool and was **not** created. Such a branch does not automatically carry the source project's data, so it alone cannot prove a full logical backup restores. Local `pg_dump`, `pg_restore`, `psql`, PostgreSQL server and Docker are absent from this executor. No backup was obtained, no timestamp or source can be attested, and no restore was attempted.

An isolated operator-controlled PostgreSQL target with PostgreSQL 17, a protected logical export including schema/roles/data and Auth scope, and verified restore permissions could demonstrate recovery without a new Supabase project. The source identity, export timestamp and checksums, restored object and protected-row fingerprints, and documented limits for platform-managed Auth/storage resources must be recorded. Stop if this cannot be done without unexpected risk or charges.

## Live Gate 0 not yet met

No integration Preview exists; deployment ID, SSO status and branch runtime configuration are unavailable. The operator should set the active Rehearsal legacy `service_role` JWT only on the exact recovery branch's Preview scope after publication. Keep the runtime operator token and expiry disabled until a protected deployment is ready; set a bounded window, invoke once, then expire and rotate the token. A fixed `ADP-GOLD-RUNTIME-READY` code will establish Data API acceptance and Release 121 readiness at that deployed runtime; other fixed codes stop the gate. SQL installation, disposable fixtures, Mux and upload/playback switches remain excluded.
