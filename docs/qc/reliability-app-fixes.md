# Reliability application candidate

Base: `fec7af1d7bc577234e62715b6721de10b870ef84`. Application-only candidate. Production, Preview, playback switches and database remain unchanged.

| Astra ID | Reproduced failure and correction | Validation limits |
| --- | --- | --- |
| QC-009 | Hung session and heartbeat responses could leave requests pending indefinitely. The player bounds fetch and response reading to 10 seconds, retries an unknown heartbeat result with the same receipt ID and sequence, and stops local playback while reconciliation is pending. A failed session can be retried explicitly. | Four recovery unit tests cover timeout, lost final receipt, retry disposal and body timeout. Authenticated browser test with real Mux and Release 121 remains outstanding. |
| QC-010 | Rounded coverage could show 100% without a completion record. Incomplete display caps at 99.9%; a server-confirmed completion updates the player and refreshes the watch page. | Unit tests only. Browser test must verify live watch summary after the final receipt. |
| QC-016 | The timeline built one segment for each media second. It now renders one marker per stored interval. | Unit test covers a long video with one interval; performance needs browser measurement. |
| QC-017 | A single Data API dashboard request could silently omit rows beyond the response cap. The dashboard pages with exact counts, stable key order and a 20,000-row safety limit; inconsistent pages fail visibly. | Unit tests cover full and inconsistent pagination. Concurrent row changes can cause an explicit error and retry; a DB snapshot or server-side aggregate remains future work. |
| QC-019 | A GET link could sign out a session, and admin writes lacked an origin/content-type gate. Sign-out now requires same-origin POST; admin JSON mutations reject cross-origin requests. | Route tests cover GET, forged POST, valid POST, cross-origin JSON and non-JSON. Browser CSRF checks and reverse-proxy origin behavior need protected Preview verification. |

## SQL-dependent work held separately

- QC-003: Release 121 currently counts elapsed time from `active_since` to the next heartbeat without a bounded gap. A database-side limit must preserve the idempotent receipt check and lock ordering, stop active-time accrual after a gap, and reject advancement until a new play event. A 20-second candidate threshold requires a product decision and isolated Postgres/RPC tests for latency, background tab throttling, seek and concurrent receipts. The repository migration is not the complete deployed verified-media-end function; do not replace production definitions from it.
- QC-013: `adp_admin_progress` already writes its audit row inside its SECURITY DEFINER transaction. Video/whitelist writes still use separate Data API mutations and audit inserts. A narrow privileged RPC per mutation with explicit `auth.uid()`, current whitelist/admin checks, row locks, affected-row checks, and atomic audit insertion requires an isolated Release 121 database and direct-role matrix before wiring the API. Mux upload creation remains an external operation and needs a recoverable compensation record.
- QC-007: Server Component cookie refresh failures require an authenticated SSR browser fixture to assess. The current `resolveMember` calls `getUser` on each protected request. A request middleware cookie-refresh change would touch all protected routes; defer until isolated login/expiry tests can verify it.

Rollback is an application commit revert. No data restoration is required. Keep automatic Preview deployment paused and QC-014 blocked until branch-scoped credential identity is verified. Do not promote this candidate until authenticated playback and authorization tests pass.
