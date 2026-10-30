# ADP Internal Training Portal

A small private video library for the Analytics Development Program. It uses Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/Postgres, Discord OAuth, and Mux signed playback. Vercel is the deployment target.

This is a purpose-built video portal, not a general LMS. It provides a private library, sequential watch progress, whitelist and administrator tools, and an audit trail.

## Run locally

1. Install Node.js 20.9+ and run `npm install`.
2. Create the Supabase and Mux projects described below.
3. Copy `.env.example` to `.env.local` and enter the server and public keys.
4. Apply the SQL files in `supabase/migrations/` in filename order using the Supabase SQL Editor or Supabase CLI. Do not skip a migration. Keep `PLAYBACK_HEARTBEATS_ENABLED=false` until migration 007 and its postflight checks are complete.
5. Set the Discord and Supabase callback URLs as described below.
6. Run `npm run dev` and open `http://localhost:3000`.

`npm run typecheck` checks TypeScript. `npm run build` creates the production build.

## Environment variables

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical origin, e.g. `http://localhost:3000` or the Vercel production URL. |
| `PLAYBACK_HEARTBEATS_ENABLED` | Server-only application rollout gate. Keep `false` during schema changes; set to `true` only after migration 007 and Release 1.2 checks are confirmed. Missing values fail closed. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key. This key is safe for browser use because tables have RLS; the app currently uses it for the cookie session client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key. Never add a `NEXT_PUBLIC_` prefix. |
| `INITIAL_ADMIN_DISCORD_ID` | Discord snowflake ID for the first administrator. They must sign in once to create their profile and bootstrap the whitelist and administrator role. |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Server-only Mux API access token. |
| `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` | Mux playback signing key ID and its base64 private key, stored server-side. |

Do not commit `.env.local` or enter private keys into client components. `.gitignore` excludes `.env*` except the example template.

## Configure Discord OAuth through Supabase

1. In the Discord Developer Portal, create an application and add an OAuth2 redirect URL equal to the callback shown in Supabase: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase **Authentication → Sign In / Providers → Discord**, enable Discord and enter the Discord application Client ID and Client Secret.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to the app origin. Add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` to the allowed redirect URLs.
4. Add the Discord numeric account ID for the bootstrap administrator as `INITIAL_ADMIN_DISCORD_ID` in local and Vercel server environment variables. Redeploy after setting it.
5. Sign in as that Discord account once. The callback stores its profile and inserts its ID into both the whitelist and administrator role tables. Other successful Discord logins only create a profile; they are not automatically authorized.

The callback reads the Discord provider identity ID from Supabase's linked identity record and uses that server-stored profile ID for later authorization checks. User-editable auth metadata is used only as a display-name/avatar fallback, never for access control. If your Supabase project returns the provider identity fields differently, adjust the identity mapping in `src/lib/auth.ts` after inspecting a real callback user.

## Configure Mux

1. Create a Mux environment and an API access token with permission to upload and manage assets. Put its ID and secret in the server environment variables.
2. In Mux **Settings → Signing Keys**, create a signing key. Store its key ID and base64 private key in `MUX_SIGNING_KEY_ID` and `MUX_SIGNING_PRIVATE_KEY`.
3. The admin dashboard requests a short-lived direct-upload URL from the server. The browser sends the file directly to Mux; it never passes through a Vercel function body limit. Assets are created with the `signed` playback policy, and the app issues signed playback tokens only after an access check.
4. Upload processing is polled from the admin page. Once Mux reports the asset ready, the draft is updated with the signed playback ID and duration. Set a thumbnail URL if you want to override the branded default tile.

## Database and security model

The SQL migrations create profiles, Discord whitelist IDs, administrator roles, videos, user progress, watched intervals, completion records, playback sessions, and administrator audit logs. RLS is enabled for all tables. Authenticated members can read only their own progress and intervals; administrators can read all rows. Mutations to watch progress are performed only by security-definer Postgres functions.

For each playback session, the server chooses the first not-yet-covered time range and invalidates the previous player session for that member/video. Heartbeats use a server-maintained active-time budget, a locked session version, a monotonic per-session event sequence, and request receipts for idempotent retries. There is no precision reserve. Forward position is floored to millisecond precision and must fit entirely within eligible server-observed active time. Pauses and buffering stop the server clock when their ordered transitions are accepted. Sessions expire after 12 hours according to database time; opening a lesson after expiry creates a new session and does not reactivate the expired session.

This accounting is not proof that the media actually played. The server trusts a structurally valid client event to enter or leave its active state and then measures elapsed database time in that state. A modified client can falsely report playback active and wait for wall-clock time. The server constrains claimed forward progress to that time budget, but without independent playback evidence it cannot prove actual playback or attention. The portal is not proctoring and must not describe completion as proof of attention.

Completion uses normalized interval coverage with no positive gaps and exact stored boundaries. Durations and positions are represented to millisecond precision; this is a metadata precision limit, not an allowance added to each heartbeat. Migration 007 preserves every existing interval but tags it `legacy`; no legacy interval contributes to verified coverage or verified completion, even if its duration matches Mux or its boundaries appear plausible. Only intervals written by the R1.2 heartbeat path carry `release_1_2` provenance. They can contribute to coverage after duration verification and safe reconciliation. Historical `user_video_progress.completed_at` and `completion_records` remain untouched and are presented as historical. Current verified completion is stored separately in `verified_completion_records`, keyed to the Mux asset and millisecond-rounded duration; earning it does not replace historical completion dates.

### Release 1.2 migration and deployment

Migrations are forward-only. Do not edit or re-run an already applied migration blindly. The exact sequence is `202610290001_init.sql`, `202610300001`–`202610300004`, `202610300005_verified_playback_budget.sql`, `202610300006_release_1_1_integrity.sql`, then `202610300007_release_1_2_progress_provenance.sql`. Migrations 005/006 are not production states; apply the pair and 007 in one controlled maintenance window with playback disabled throughout. Do not route traffic to an R1.1 application between migrations. Migration 007 starts with database playback control disabled and only its final commit marks version 12 ready.

**Preflight**

1. Confirm the applied migration history in every environment. Back up the database and rehearse the pair on a disposable clone first. Do not assume a failed migration was fully rolled back; inspect the migration ledger, column types, constraints, and function definitions after any error.
2. Save the output of `supabase/deployment/release_1_2_capture_playback_acl.sql`. It captures direct EXECUTE grants on the exact playback RPCs. The maintenance scripts change only those functions and the ADP playback control row; they never revoke `USAGE` on `public` and do not touch Storage, Realtime, tables, or unrelated APIs. Disable uses `CASCADE` only on listed playback functions, so inspect the capture and dependent grant chain first. Enable restores only R1.2 execution to `authenticated`, not arbitrary custom grants. Reconcile any required project-specific playback integration grants explicitly after review.
3. Inventory all published video IDs, Mux upload IDs, current durations, and readiness. Confirm the Mux credentials and signed playback IDs work. Record which assets Mux cannot currently verify.
4. Deploy the R1.2 application with `PLAYBACK_HEARTBEATS_ENABLED=false`; it requires database integrity version 12 and calls only R12 session/heartbeat RPCs. It never falls back to an older RPC. Keep the previous application deployment unrouted.
5. Put player routes behind the hosting maintenance page or otherwise stop player traffic. As database owner, run `release_1_2_disable_playback.sql`. This narrowly disables known playback RPCs and, where present, turns off the R1.2 database control row. Keep the public site/application routes available only if they cannot invoke legacy playback RPCs; safest is host maintenance for player endpoints. Other public-schema APIs remain accessible.

**Apply and recover**

6. Apply 005, then immediately rerun `release_1_2_disable_playback.sql` before applying 006: 005 restores authenticated grants on its legacy signatures. Apply 006, then immediately rerun the disable script before applying 007: 006 grants authenticated execution on R11. This re-revocation is required even while the application gate is false, because direct PostgREST RPC calls do not use the app gate. Keep the window free of player traffic. If a migration fails, keep the app gate false, host maintenance in place, and rerun the disable script before investigating. Inspect the migration ledger, actual columns/functions/constraints, playback-control row, grants, and row counts. Do not route the old app or assume a rollback is safe. Complete the migration pair and 007 or use a reviewed forward repair. After 007 failure, if its transaction rolled back, 006 remains the schema state but RPC revocations from the separate maintenance script remain. If a runner partially executed non-transactional statements, determine the exact state before repair. Never retry blindly.
7. Verify integrity version 12 is ready, `adp_playback_control.enabled` is false, R12 functions exist, old RPCs are not executable by app roles, no precision reserve exists, and all historical interval/progress/completion IDs and values remain. Verify intervals are labeled legacy and verified completion rows are separate. Then run `release_1_2_enable_playback.sql`; it refuses to enable unless the marker and RPCs are correct, turns on the database control, and grants only the R12 functions to `authenticated`.

**Restore service**

8. With application heartbeat traffic still off, refresh Mux metadata for published videos. The dashboard displays individual failures and does not mark duration verified unless a ready Mux asset returns a valid duration and signed playback ID and the database update succeeds. Unverified published videos remain playable after service resumes if they have a usable playback ID and positive legacy duration, but they cannot earn verified completion until sync succeeds. Existing legacy coverage is not promoted by any duration match.
9. Run postflight SQL and app checks, then set `PLAYBACK_HEARTBEATS_ENABLED=true` and deploy. Confirm the version check returns 12 and create a fresh session before removing host maintenance. Have open players reload.
10. Verify authorized member playback, pause/resume, blocked forward seek, persisted R1.2 interval provenance, live server-confirmed progress, separate verified completion, historical completion labels, and admin progress. Confirm every unresolved Mux sync reason is visible.

Heartbeat receipts are kept for the full 12-hour session lifetime, including sessions superseded by another tab. No automatic cleanup schedule is installed. After expiry, an operator may invoke `public.cleanup_expired_playback_receipts()` with the service role; it expires sessions using database time and deletes only receipts whose parent session is expired.

Legacy interval rows are preserved verbatim as historical/unverified and never count toward verified coverage. They are not “reconciled” into verified status under matching, shorter, or longer Mux durations. New R1.2-provenance intervals recorded while duration is unverified remain preserved and can be reconciled after valid Mux sync: if legacy and verified durations match within 0.5 ms, coverage is bounded to the verified duration; when they differ, only the common range through one millisecond before its endpoint is retained as eligible, requiring the endpoint to be watched again. For a longer duration, the newly added tail must also be watched. This policy deliberately avoids assuming unverified endpoint evidence.

### Migration failure and recovery

Before the window, rehearse all three migrations and maintenance SQL on a disposable clone, capture the listed RPC grants, take a restorable backup, and snapshot interval/progress/completion row counts and hashes. Keep the app environment gate false and player endpoints in host maintenance. Disable the exact RPCs with `release_1_2_disable_playback.sql`. Apply 005, 006, then 007. Each migration file is a single PostgreSQL transaction by default unless the chosen migration runner wraps or splits execution; verify the runner behavior and migration ledger rather than assuming. The scripts do not downgrade. If any migration fails, leave the app gate false and maintenance active, rerun the read-only schema/grant/count inspection, and repair forward from the actual committed state. Do not restore an old app against a newer schema. Re-enable only after 007 commits and `release_1_2_enable_playback.sql` checks the ready marker and RPC signatures. Recovery may require a reviewed forward migration; use a backup restore only as an explicit disaster-recovery decision after assessing newer writes.

The numeric type changes in migration 005 may take exclusive table locks and rewrite rows, particularly for integer-to-numeric duration conversion. Its five-second `lock_timeout` bounds only lock acquisition wait, not the duration of a rewrite after lock acquisition. Estimate table size and rehearse on a clone; use a maintenance window and have a verified backup/forward-repair plan.

### Database-level regression tests

The pgTAP suite in `supabase/tests/progress_integrity.sql` exercises PostgreSQL functions and persisted rows, including a three-minute sequence of 1× heartbeats (24 database sleeps of eight seconds), historical provenance, and separate completion records. The migration preservation pair seeds records before migration 005 and checks them after migration 007. `progress_integrity_concurrency.py` uses separate `psql` processes/connections and refuses non-loopback database hosts. These require a disposable local Supabase database; do not run them against the configured project. `player_lifecycle.test.mjs` is a fast unit test; `player_lifecycle.browser.html` is a browser harness that imports the same lifecycle helpers used by the React player. Run `npm run serve:player-lifecycle:browser` and open `http://127.0.0.1:4177/`; a PASS result appears in the page when browser events and recovery assertions succeed.

```sh
supabase start
supabase test db
```

For the real concurrent test, first confirm the local database is disposable and set `ADP_TEST_DATABASE_URL` to its loopback PostgreSQL URL plus `ADP_ALLOW_LOCAL_DB_TEST=1`, then run `npm run test:progress-concurrency`. The Mux refresh failure-path unit tests use mocked dependency results: `npm run test:duration-sync`.

For the migration preservation check, use a fresh disposable database: apply migrations 001–004, set PostgreSQL option `adp.allow_progress_migration_fixture=on`, and run `progress_integrity_migration_before.sql`; then apply migrations 005, 006, and 007, run `progress_integrity_migration_after.sql`, and discard the test database. The fixture file refuses to run without the explicit session option.

The suite creates isolated test fixtures inside a transaction and rolls them back. It is intentionally not run against the configured production Supabase project.

The client disables playback-rate choices and blocks forward seeking. As with any browser player, these checks cannot prove attention or prevent screen capture or all developer-tool manipulation. The server budget measures database wall time while a client-declared session is active; it enforces a time bound on claimed progress but does not prove the Mux player was actually rendering or a user was watching. Signed Mux playback tokens are bearer URLs and remain valid until their expiry (video duration plus a small buffer); no browser-only design can instantly revoke a token already issued to Mux.

## Administrator use

- Add a Discord snowflake to the whitelist even if that user has not signed in yet. When they later log in, their profile appears in the member table.
- Remove access from the member table. The bootstrap administrator cannot remove their own configured initial access.
- Upload videos to Mux, edit titles/descriptions/order, set thumbnail URLs, publish/unpublish, or delete assets.
- Review each member/video state and covered duration, reset progress, or explicitly mark a lesson complete. Administrative actions are written to `admin_audit_log`.

The bootstrap ID is the only admin role granted automatically. To grant another administrator, an operator must verify the target Discord ID and insert it in both `administrator_roles` and `authorized_discord_ids` in Supabase; the app does not provide self-service admin promotion.

## Deploy on Vercel

1. Push the project to a private GitHub repository and import it into Vercel.
2. Set the variables above for the Production and Preview environments as needed. Use the production URL for `NEXT_PUBLIC_APP_URL` in Production; add preview URLs to Supabase allowed redirects only if you intend to use OAuth there.
3. Add `https://<your-vercel-domain>/auth/callback` to Supabase's allowed redirect URLs. Keep Discord's OAuth redirect pointed at Supabase's provider callback URL.
4. Deploy, then sign in with the initial administrator and upload a small test video.

The implementation avoids storing video files in Vercel and is compatible with Vercel's serverless request model. Free plans and included usage for Vercel, Supabase, and Mux can change and are subject to quotas; check current account limits and costs before uploading or streaming at scale. Mux video storage and delivery may incur charges even when the application hosting tier is free.

## Before live use

Configure RLS by applying the migration to the intended Supabase project, verify the Discord provider metadata shape, test sign-in as both an authorized and unauthorized account, and exercise the upload and watch flows with real Mux credentials. No production credentials are present in this repository, so live OAuth, Mux upload, and hosted mobile/desktop validation must be run after setup.

