# Gold Rehearsal acceptance execution plan (21 November 2026)

This updates the historical status in [GOLD-rehearsal-acceptance.md](GOLD-rehearsal-acceptance.md). The recovered source is local-only on `recovery/gold-verified-20261121`; `audit/gold-local-candidate` remains a separate probe-only remote branch. No Gold application deployment or Gold SQL installation is authorized by this plan.

## Source and scope lock

The reviewed candidate is `57ccb3e53338418604c1bb2117acc4c9b016593e`, prepared at `77f6fd0396f4fcf5b79b2e08ff9073214ac456b4`. Local acceptance harness preparation continues on that ancestry. Before any integration deployment, publish the isolated `recovery/gold-verified-20261121` branch only after authorization, verify `vercel.json` still suppresses automatic Git deployment for **both** it and the probe branch, and prove Preview variables are scoped to the recovery branch. Never deploy the probe-only branch or inherit shared Preview secrets. Require explicit integration deployment authorization.

Pin these five SHA-256 values before installation and cleanup:

| Artifact | SHA-256 |
| --- | --- |
| `qc026_upload_intents_candidate.sql` | `e4a578db2bf5d3e524be1aac49a0e24d30feb7b25a05f52c07ad61df853b3a77` |
| `qc026_reconcile_extension.sql` | `ee67df0638a51ea47a893eb4e4196b2cd21929a17ac643c3677653a94e2eb646` |
| `gold_training_sequence_candidate.sql` | `40382714e109d42679a8c83b30ea9068dfa5f30b46692367fcdfb4190c01b700` |
| `acceptance/qc026_reconcile_cleanup.sql` | `6aabd26f09bda84f93bd9450418bd443a135413abfe30df939f1538cbba0fe90` |
| `acceptance/gold_disposable_cleanup.sql.in` | `b320b041ea8f860c3651073d94f5a4ff2fb4d7a1d0b8ef9fd562bbf51be2420b` |

## One-time credential correction and proof

The Rehearsal gateway recorded `UNAUTHORIZED_INVALID_API_KEY` on both credential headers for the read-only identity request. After the isolated integration branch is authorized and published, open Vercel's `uther/adp-training-portal` project, select the **Preview** environment and exact branch scope `recovery/gold-verified-20261121`, and edit its `SUPABASE_SERVICE_ROLE_KEY` Secret. Enter the currently active **legacy `service_role` JWT** from the Supabase ADP-Rehearsal project `nqqarmkgnuvvqnvnodyc` directly in Vercel. Verify the branch and environment labels in the confirmation screen. Do not use the anon JWT, Production project, shared Preview entry, `sb_secret_` format, or a copied value in chat or a command. This corrects a stored value; it does not rotate the Supabase credential. If the branch-scoped entry does not yet exist, create it with precisely that branch restriction; inspect the branch-specific variable list before deploying.

The probe-only branch must remain undeployed. A Vercel variable update does not change a removed immutable deployment. Scope the recovery branch's own service-role Secret and other required variables after that branch is authorized for publication. A corrected probe-branch Secret does not establish the recovery branch's credential. To minimize handling, the operator may defer the one correction until the isolated branch is published and then set the active Rehearsal JWT directly on that branch; the probe-only branch needs no further deployments. The recovered app's QC-014 route has a historical fixed Preview origin and separate gate. The newly prepared `/api/diagnostics/gold-runtime` route instead requires the recovery branch, Preview environment, Rehearsal URL/reference, disabled feature switches, a 32+ character operator token and expiry within 15 minutes. It reads Release 121 through the runtime service-role credential and returns only a fixed code. Its branch-scoped `ADP_GOLD_RUNTIME_TOKEN` and `ADP_GOLD_RUNTIME_UNTIL` must be created separately, left expired by default, enabled only for a bounded protected invocation, and disabled and rotated immediately afterward. Keep the token out of shell arguments and logs. A `HTTP-401` or any non-ready result stops the session. No deployment or credential check has yet been executed.

## Gate 0: stop before changes unless all pass

1. Confirm Supabase connection identity from the live database, Release 121 readiness, `verified_media_end_rehearsal`, disabled Rehearsal app and database playback/upload switches, zero active playback sessions, and the exact catalog, function, ACL, RLS, sequence and protected-row baselines in `acceptance/qc026_readonly_fingerprint.sql`. Check jobs, locks, and Preview traffic. Never point the runner at Production.
2. Capture a logical schema, roles, and data backup for Rehearsal, including Auth and protected rows. Verify the backup can be read and restore it in an isolated destination under a separately authorized restore plan. Record backup identifiers, scope, time, and tested recovery method. A project snapshot label alone is insufficient.
3. Confirm the protected runner can access Rehearsal Auth Admin, the Data API, and two independent PostgreSQL connections. Supply all credentials through a protected process environment; disable shell transcript/command tracing and prevent logs from storing environment values, tokens, response bodies or database records. The existing Supabase connector alone does not provide Auth Admin or direct Data API access. Invoke the gated runtime check and require `ADP-GOLD-RUNTIME-READY` before installation.
4. Prepare unique disposable admin, whitelisted member, revoked member and nonmember identifiers, exact cleanup IDs and an evidence ledger. Do not create them before Gate 2 authorization. Confirm the integration Preview is SSO protected and branch-isolated before deployment.

## Gate 1: bounded installation and ACL proof

Only after Gate 0 and explicit SQL authorization, install the pinned bounded QC-026 base, recovery extension, and progression candidate in the order in the original runbook. Recheck source bytes and preconditions before each. Read back owner, definitions, table RLS and effective grants for all seven external upload RPCs, internal helpers, progression wrappers, and original R12 playback RPCs. Stop before fixtures on any deviation. Keep upload and playback disabled.

## Gate 2: Auth/Data API and concurrency

Only after fixture authorization, create uniquely tagged disposable Auth users through a protected administrator channel and record exact IDs in the evidence ledger. Use `acceptance/qc026_data_api_matrix.mjs` against the verified Rehearsal host with protected `ADP_QC026_*` environment inputs. It performs permission checks without writing fixture rows and emits only sanitized statuses and categorical codes. Complete the remaining valid/revoked actor, member/nonmember, helper, DELETE denial and table-count checks from the original runbook. Do not mistake a missing RPC (`PGRST202`) for successful installation; Gate 1's catalog proof must independently establish each function.

For genuine database races, supply protected libpq settings (`PGHOST`, `PGUSER`, `PGDATABASE=postgres`, `PGSSLMODE=verify-full`, `PGPASSWORD`) and disposable UUIDs through the runner environment. The direct host is `db.nqqarmkgnuvvqnvnodyc.supabase.co` with `PGUSER=postgres`; an independently verified Supabase pooler may use `PGUSER=postgres.nqqarmkgnuvvqnvnodyc`. Set `ADP_QC026_EXPECTED_REF=nqqarmkgnuvvqnvnodyc` and `ADP_QC026_ACCEPTANCE_AUTHORIZED=GATE2_APPROVED` only in the protected authorized process. Run `node supabase/batch3/acceptance/qc026_race_runner.mjs reserve`, confirm exactly one winner and one intent/video, then `claim` against the same operation, confirming exactly one winner. The runner starts two separate `psql` processes concurrently and requires distinct backend PIDs and intersecting transaction time intervals. A lock timeout, incomplete evidence or two winners stops the session; inspect the fixture before cleanup. Capture categorical results and counts, never raw connection output.

Use two synthetic published modules and a comparison module to prove module two remains locked with interrupted progress, historical completion, premature end, or stale asset proof. Only a real verified completion from the authenticated heartbeat path in Gate 3 may unlock it. Do not insert a synthetic current completion.

## Gate 3: one bounded media and browser session

Only after earlier gates pass and provider usage is authorized within existing allowances, use one short disposable Mux media item. Follow the original runbook's upload, ambiguous response reconciliation, expired URL, mismatch, retry and single-binding checks. Exercise authorized and revoked accounts, pause/reload/resume, duplicate heartbeat receipt, forward seek denial, expiry, buffer recovery, first module completion and second module unlock on the protected integration Preview. Check Firefox and Chromium controls. Temporarily enabling Rehearsal playback/upload requires a separate bounded approval, followed by an immediate return to OFF. Production remains Version 12 with both features OFF throughout.

## Stop, cleanup, rollback and release gate

Keep an append-only evidence ledger of exact disposable IDs and sanitized status/results. At any failed gate, turn Rehearsal switches OFF, stop provider operations, preserve ambiguous provider resources, and use the ID-specific cleanup template after FK and provenance checks. Delete disposable Auth users through the protected administrator channel. Verify baseline protected-row hashes and ACLs; audit rows and sequence allocations are expected persistent effects and must not be rewound. For schema rollback, restore captured R12 grants after removing progression wrappers, remove the recovery extension, and remove the QC-026 base only if its ledger is empty. Use the pinned cleanup artifacts and the original runbook's order; never CASCADE.

Acceptance closes only with independent post-cleanup evidence: switches OFF, no disposable users or active sessions, no unknown provider uploads, protected rows intact, exact installed object and ACL inventory, and no unreviewed Preview deployments. Prepare a source-identified Production candidate only after all Rehearsal gates pass. Production release and Production SQL remain separately authorized actions.
