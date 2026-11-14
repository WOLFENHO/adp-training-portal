# Consolidated isolated integration gate

Use one disposable Release 121 restore whose project reference and service-role identity have passed QC-014's read-only protected check. Keep production and Sites separate. Snapshot function definitions, owners, grants, policies, triggers and row counts before each rollback-only test. Set an explicit nonproduction marker, and verify the connection target before every SQL transaction. Never replay baseline migrations in Production.

| Finding | Isolated test | Pass condition |
| --- | --- | --- |
| QC-002/005 | Anon, member, valid admin, revoked admin, wrong-owner Data API and `adp_admin_progress` RPC | Valid admin only; revocation takes effect without refreshing a role cache; failed actions leave audit and progress unchanged. |
| QC-003 | Continuous playback, silent gap on both sides of provisional threshold, duplicate receipt, forged client position | Gap and seek earn no coverage; normal coverage and exact duplicate decision remain intact. Threshold needs a product decision. |
| QC-006 | Clean installation versus upgrade from captured deployed definitions | Function/owner/ACL/RLS/trigger fingerprints and media-end behavior converge; no baseline replay in Production. |
| QC-007 | Expired access token across server-only navigation, concurrent tabs, revoked session | Refresh persists cookies safely; denied user never reaches member/admin route. |
| QC-013 | Audit insert failure, concurrent video edit/unpublish and metadata sync with two connections | Database mutation and audit commit together; rejected and rolled-back attempts leave no partial change. |
| QC-014 | Protected read-only service-role identity probe and negative configuration cases | Exact rehearsal project only; missing or mismatched values fail before privileged reads. Preview pause remains until separately approved. |
| QC-017 | 0/1/20/50/51/10k rows, cursor tamper, admin revocation between pages, concurrent inserts/deletes, oversized text, historical/verified records | No duplicate or hidden truncation; failed pages remain visible as errors; current verified asset identity is required. |
| QC-026 | Concurrent same-operation reserve, crash at each Mux/DB boundary, lost response, URL expiry, paged provider listing, ambiguous orphan | One provider create per operation; no automatic second create or asset deletion; manual review on uncertainty. |
| Player/Mux | Signed asset, pause/reload, denied forward seek, lost heartbeat, token expiry, verified end, maintenance shutdown | Only eligible footage credited; exactly one verified completion; prior token behavior is documented. |

Execute fixture tests only after isolation, grants and SQL fingerprints are verified. Browser checks require disposable OAuth identities and a test asset. Preserve the 20-second gap as provisional. The current SQL branch is unexecuted and the current application branch is unmerged.
