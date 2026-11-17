# Consolidated audit candidate (unmerged)

Application parent: `498773a7392eaed94bd3f86814919e3c69efa6ae`.
The SQL files in `supabase/batch2` and `supabase/batch3` originate from
`ecab89bd47e7132daa50610cf03539c7ef3cb037`; existing source branches are
unchanged. None of these SQL candidates has been applied to a hosted database.

## QC-026 integration

The authenticated `video-create` route now requires stable operation/video UUIDs.
It reserves an unpublished video, intent and audit event through one RPC before
Mux creation. The claim and bind RPCs serialize attempts and commit provider
target plus video binding together. Unknown provider outcomes move to durable
review and cannot automatically create a second Mux upload. The browser keeps
the operation UUID during retry and reload. An administrator-only read-only
review counts all provider uploads associated with the reserved video and
returns no signed upload URL. It never deletes provider resources.

The SQL candidate remains subject to a disposable Release 121 transaction and
role matrix. Actual Mux listing, URL expiration, provider identity, SQL
concurrency and crash boundaries remain unverified. A single unbound provider
match remains manual review; the application does not automatically claim it.
The metadata-sync path requires the intent table before application deployment
and finalizes only when the provider passthrough and saved video identity match.

## QC-005 and QC-006

`adp_admin_progress` already contains `auth.uid()`, current whitelist and
administrator checks in the repository definition. Its live owner/definition
and ACL must be captured before applying the guarded grant candidate. The
application now sanitizes RPC denial instead of echoing database details.
QC-006 remains a fresh deployed-definition and clean-install/upgrade
convergence gate. A Release 121 marker alone cannot prove parity.

## Rollback and order

Keep application and SQL changes independently reviewable. Snapshot live
definitions, ACLs and relevant record counts. Validate the isolated SQL and
role matrices, then approve narrowly scoped SQL before deploying the new
application route. Reverting the application restores the earlier Mux-first
behavior; if any intent exists, leave its row and Mux resource in place for
manual recovery. SQL rollback requires a reviewed transaction and must retain
intent records while any are nonterminal or ambiguous. Preserve unpublish-only
media handling and verified training history.
