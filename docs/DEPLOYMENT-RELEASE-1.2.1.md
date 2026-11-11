# ADP Release 1.2.1 — deployment guide for first-time operators

This guide prepares a test deployment. Release 1.2.1 is not production-verified. Nothing in this guide authorizes applying production migrations or buying services. Your separately approved GitHub main push can trigger the existing Vercel integration; that approval does not approve database changes or paid video uploads.

The README and .env.example were cleared by existing upstream commits and have been left that way. Use this guide and ENVIRONMENT.md instead. The current source, not the old source ZIP, is authoritative.

## 1. Understand the pieces

- GitHub stores the application source and migration history. A commit is a saved revision.
- Vercel builds and runs Next.js. A deployment is a running copy of a particular commit.
- Supabase stores users and progress and handles Discord sign-in. A migration changes database structure/functions.
- Discord identifies the member. Discord login alone does not grant portal access.
- Mux stores/streams videos and verifies signed playback tokens.
- An environment variable is a named setting. A secret is a setting that must stay private. A callback URL is the destination to which a login provider returns the browser.
- Preview/staging is a test environment. Production is the environment real members depend on.

Use separate test and production Supabase/Mux credentials. Do not connect a preview website to the production database. Vercel's Preview/Production labels alone do not isolate a database: the environment variables determine which database is used.

## 2. What is already prepared, and what still needs you

Prepared locally: Release 1.2.1 source, Migration 008, narrow maintenance scripts, database regression and concurrency tests, actual React player queue harness, environment-name inventory, and Vercel-compatible Next.js build configuration.

Requires your dashboard interaction and explicit approval: checking account plans/usage; creating or choosing isolated test projects; installing/starting Docker locally; setting Discord application credentials; storing secrets in Vercel; approving any billable Mux upload; inspecting the automatic Vercel deployment; and later approving production migration/release. Do not paste secret values into chat or GitHub.

Remaining verification: PostgreSQL suites, actual row locks/concurrent transactions, migration preservation/failure rehearsal, React browser harness execution, authenticated Discord/Supabase/Mux playback, and the deployed Vercel build. Local Node tests use mocks where indicated. See RELEASE-1.2.1-VERIFICATION.md.

## 3. Check plans before using resources

Open Billing/Usage in each existing dashboard. Confirm quotas, project limits, and plan eligibility without upgrading or adding a card automatically. Vercel Hobby is restricted to personal non-commercial use; an organization training portal must check eligibility. Mux storage/encoding/delivery may be billable.

Important: this application's upload endpoint does not set Mux's test-asset flag. Naming a Mux environment "Test" does not make uploads free. Do not click Upload until you approve the usage or establish that it incurs no paid charge. No automatic upload is part of preparation.

References: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Mux environments](https://www.mux.com/docs/core/mux-fundamentals).

## 4. Account inventory — dashboard work

Keep a private checklist in your password manager, with separate TEST and PRODUCTION sections:

1. GitHub: repository WOLFENHO/adp-training-portal, branch main, and who can push. Confirm repository visibility matches your organization's requirements.
2. Vercel: select the existing project, note the connected repository and production branch, and inspect automatic deployments. A push to the production branch normally triggers a production deployment. You approved the current push; future releases still require deliberate review.
3. Supabase: select the intended TEST project, record its display name/project reference privately, and confirm it is not the production project. Do not reset or migrate an existing project from memory.
4. Discord Developer Portal: choose/create a separate application for TEST when possible. It has a Client ID and Client Secret.
5. Mux: select the intended TEST environment before creating API/signing keys. Keep all keys and assets from that same environment together.

References: [Vercel Git deployment behavior](https://vercel.com/docs/git), [Supabase Discord setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-discord).

## 5. Prepare local verification tools

On Windows, install tools only from their official sources: a supported Node.js LTS release, Git, Docker Desktop with its required Windows virtualization/WSL setup, PostgreSQL command-line tools including psql, and the Supabase CLI. Check licenses/plan requirements before installing software that needs payment. Reopen PowerShell after installation so PATH changes apply.

Check availability:

```powershell
node --version
npm --version
git --version
docker --version
psql --version
supabase --version
```

The local build here used Node 26.13.0; that is not proof of Vercel's Node runtime. Select a supported LTS version in Vercel (for example 24.x if offered), use the same version locally for final staging verification, and rerun tests. No engines constraint has been added to force an untested runtime.

From the repository root:

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

Expected: 19 Node tests, no TypeScript errors, and a completed production build. Database correctness is not established by these tests. Windows sandbox builds may report EPERM; the same build completed outside this agent's sandbox. Use a normal local terminal if necessary and retain the actual error if it still fails. Never report compilation alone as a completed build.

Next configuration: Next.js framework, repository root as file-tracing root, .next production output, .next-dev development output. npm run build uses a guarded output cleanup and exclusive .adp-build.lock. Confirm no build is running before removing a stale lock; do not delete arbitrary parent directories.

Reference: [Vercel-supported Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).

## 6. Run the disposable migration rehearsal FIRST

This is local-only. Do not use the production connection URL, supabase link, a remote db push, or --linked reset.

The rehearsal runner needs an EMPTY application database with Supabase's base auth schema and roles. Running supabase start in the ADP repository can automatically apply all application migrations first, which defeats the before/after preservation test. Instead create a separate empty CLI workspace under the ignored work directory:

```powershell
# Run from the ADP repository root. Use a NEW directory.
New-Item -ItemType Directory -Path work/adp-empty-rehearsal
Push-Location work/adp-empty-rehearsal
supabase init
# Before start, inspect supabase/config.toml: use a unique project_id.
# If another local Supabase stack is running, choose unused local ports.
supabase start
Pop-Location
```

The new workspace has no ADP migrations. Never stop, reset, or reuse someone else's local stack. Supabase start may display local credentials; keep them on your own machine, do not paste its output into chat or a repository. Obtain the LOCAL PostgreSQL URL from that stack's local status/connection details.

Run the checked-in rehearsal script from the ADP root, entering the local URL privately at the prompt:

```powershell
$env:ADP_ALLOW_LOCAL_DB_TEST='1'
$localDbSecret = Read-Host 'Disposable LOCAL database URL' -AsSecureString
$localDbUrl = [System.Net.NetworkCredential]::new('', $localDbSecret).Password
try {
  .\supabase\tests\rehearse_release_1_2_1.ps1 -DatabaseUrl $localDbUrl
} finally {
  Remove-Variable localDbUrl,localDbSecret -ErrorAction SilentlyContinue
  Remove-Item Env:\ADP_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\ADP_ALLOW_LOCAL_DB_TEST -ErrorAction SilentlyContinue
}
```

The runner rejects non-loopback database hosts. It applies the initial schema and migrations through 004, creates a protected preservation fixture, applies 005–007, disables affected RPCs, deliberately makes 008 fail, checks that its transaction rolled back, applies real 008, checks preserved history, tests repeated enable/disable, executes the two pgTAP suites, and runs real concurrent transactions. It leaves playback disabled. A deliberate SQL failure during failure injection is expected; any later assertion failure is not a pass. On failure retain sanitized error codes/file names and stop. Do not delete local data to disguise a failure.

Exact SQL sequence:

1. 202610290001_init.sql
2. 202610300001_guard_watched_interval_bounds.sql
3. 202610300002_reapply_heartbeat_interval_guard.sql
4. 202610300003_allow_verified_interval_reposition.sql
5. 202610300004_report_heartbeat_interval_writes.sql
6. 202610300005_verified_playback_budget.sql
7. 202610300006_release_1_1_integrity.sql
8. 202610300007_release_1_2_progress_provenance.sql
9. 202610300008_release_1_2_1_integrity.sql

There are nine files because the initial schema and the first later fix both end in 001. Always use filenames, not just shorthand numbers. Do not apply this whole sequence to an existing database with tables already present.

The runner's direct psql application is a rehearsal, not a managed migration-ledger installation of your hosted project. It must never be pointed at an existing remote database. For an approved hosted installation, have the operator check the actual Supabase migration ledger and function definitions and apply only missing migrations with the chosen transactional runner.

Reference: [Supabase local workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

## 7. Execute the actual React queue harness

This test needs no real video account or database response. The actual React VideoPlayer and queue run with synthetic media and intercepted HTTP requests.

```powershell
npm run dev -- --hostname 127.0.0.1 --port 4178
```

Open http://127.0.0.1:4178/dev/player-regression in your OWN browser. Require PASS for Pause and Buffering modes. Repeat at http://127.0.0.1:4178/dev/player-regression?lostResponse=1. The trace should keep request IDs stable on retries, sequence events monotonically, leave the final active state authoritative, and submit no new stop request after the newer resume.

Stop with Ctrl+C. This page intentionally returns not-found in production, including Vercel previews built in production mode. It is not a Mux rendering test. In this agent environment the browser could not reach the local server and the shell's loopback socket access was denied; no browser PASS was observed.

## 8. Prepare isolated hosted TEST accounts only after approval

Do this after local SQL tests pass. Any hosted project creation, migration execution, charge, or deployment beyond the separately approved Git push requires your approval.

Supabase TEST project: confirm its name/reference, choose the available free configuration only if eligible, and store the database password in your password manager. It is not an application environment variable. A new project's creation does not apply ADP migrations. An operator must apply/rehearse the approved schema and confirm it ends at version 121 with playback disabled. Existing projects need an inventory and backup before any change.

Open Project Settings / API or API Keys / Connect as applicable. Obtain the project URL, the public anon/publishable key, and the server service_role key. For this candidate, prefer the legacy anon/service_role JWT pair already expected by its configuration; new key types have not been authenticated-runtime-tested. Copy only into your local ignored .env.local or the correct Vercel TEST environment fields. Service-role keys bypass RLS and must never be public.

Discord TEST app: open https://discord.com/developers/applications, select the app, open OAuth2, and obtain Client ID and Client Secret. Keep the secret private. Configure the redirects described below. In Supabase TEST, open Authentication → Sign In / Providers → Discord, enable it, enter those credentials, and save. The Discord Client Secret belongs in Supabase's provider configuration, not this application's environment variables.

Mux TEST environment: obtain an API token with Video read/write access for the upload/retrieve/delete operations. Separately create a playback signing key in the same environment and privately save its ID and base64-encoded PEM private key. The runtime token does not need broad System-write access just to sign playback locally. See ENVIRONMENT.md. Do not create an upload until cost approval is clear.

References: [Supabase key types](https://supabase.com/docs/guides/getting-started/api-keys), [Mux signed playback](https://www.mux.com/docs/guides/secure-video-playback).

## 9. Configure Vercel TEST deployment

Use the existing Vercel project and architecture. Inspect its current settings before changing anything. A non-production Git branch normally creates Preview deployments; production branch main normally creates Production deployments. A Vercel deployment labeled Production may still be only a test portal if its variables target TEST services, but do not assume that is how the existing project is configured.

Dashboard → project → Settings → Build and Deployment:

- Framework preset: Next.js.
- Root directory: repository root (contains package.json); do not select outputs.
- Install command: npm ci.
- Build command: npm run build.
- Output directory: leave the Next.js default; do not choose out, static export, or a custom folder.
- Node.js: choose a supported LTS version and record it; verify the cloud build log.
- No database migration command, Supabase integration auto-migration, or upload command belongs in the build step.

Dashboard → Settings → Environment Variables: add all ten values in ENVIRONMENT.md to Preview for TEST, optionally scoped to the intended test branch. Do not copy production credentials to Preview. Keep PLAYBACK_HEARTBEATS_ENABLED=false initially. Select Sensitive for server secrets where available. Environment changes take effect on a new deployment, not an old deployment.

Choose a stable TEST HTTPS origin from the deployment/domain details. NEXT_PUBLIC_APP_URL must be that exact origin including https://, without /auth/callback or a trailing slash. If the preview address changes, update this variable, Supabase redirect allowlist, and redeploy. Do not assume VERCEL_URL is used automatically: the application explicitly reads NEXT_PUBLIC_APP_URL.

If deployment protection requires Vercel login, the tester must pass it before exercising Discord login. Do not silently disable protection. Check the build's final status and Functions/Runtime logs after deployment; redact all credentials, cookie headers, and signed playback URLs before sharing errors.

Reference: [Vercel environment variables](https://vercel.com/docs/environment-variables), [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings).

## 10. Configure the two different callback URLs

For hosted Supabase TEST, substitute your real TEST project reference and test application origin:

| Setting | Exact form | Configure it here |
|---|---|---|
| Discord OAuth redirect | https://TEST_PROJECT_REF.supabase.co/auth/v1/callback | Discord app → OAuth2 → Redirects. Use the callback copied from Supabase's Discord provider panel. |
| Supabase Site URL | https://YOUR_TEST_APP.vercel.app | Supabase TEST → Authentication → URL Configuration. |
| Supabase allowed application redirect | https://YOUR_TEST_APP.vercel.app/auth/callback | Same Supabase panel → Redirect URLs. |
| Local application redirect, if using hosted TEST auth locally | http://localhost:3000/auth/callback | Supabase TEST allowed redirects; local NEXT_PUBLIC_APP_URL must match. |
| Alternate local origin, only if used | http://127.0.0.1:3000/auth/callback | Supabase TEST allowed redirects when the app is opened with 127.0.0.1. |

Discord sends the browser to Supabase; Supabase then returns it to the application. They are not interchangeable. Use exact allowlist entries, not a production-wide wildcard. A fully local Supabase Auth stack instead uses its own callback shown by its Discord provider setup, commonly http://localhost:54321/auth/v1/callback; it also needs local provider credentials configured. Local SQL tests do not need Discord enabled.

Reference: [Official Supabase Discord instructions](https://supabase.com/docs/guides/auth/social-sign-in/auth-discord).

## 11. Create the first administrator

In Discord desktop: User Settings → Advanced → Developer Mode on. Right-click your own account and choose Copy User ID. Use that numeric ID, not a display name, email, server ID, Client ID, or bot token.

Enter it as INITIAL_ADMIN_DISCORD_ID in the TEST Vercel environment (and local ignored .env.local if testing locally). Redeploy so the variable takes effect. Once the test database schema exists, sign in using that exact Discord account. The callback creates the profile and inserts your Discord ID into both authorized_discord_ids and administrator_roles. These are server-side records; browser storage cannot grant the role.

A different Discord account can authenticate but should get access denied until you add its numeric ID to the whitelist. Use one additional test member and one non-whitelisted test account. Do not treat successful Discord login as authorization.

The configured bootstrap administrator is protected against removal in the admin endpoint and is re-bootstrapped on login. A wrong INITIAL_ADMIN_DISCORD_ID can leave you locked out; verify it privately before troubleshooting browser permissions.

## 12. Open the TEST gates and verify end to end

Only after database regressions pass and the test target is confirmed:

1. Keep ordinary testers out during setup. Database playback is initially disabled. The new app and admin API require schema marker 121; old version 12 is insufficient.
2. The approved operator runs supabase/deployment/release_1_2_1_enable_playback.sql on TEST. It validates readiness and restores only intended ADP RPC roles. Do not use the older Release 1.2 enable script.
3. Set PLAYBACK_HEARTBEATS_ENABLED=true for TEST and redeploy. Both the app gate and database gate must be on. Admin GET duration synchronization is gated too.
4. Sign in as bootstrap admin, confirm /admin loads, and add a test member.
5. After video-usage approval, upload a short non-sensitive instructional test clip. The browser uploads directly to Mux. Wait for ready status, valid signed playback ID and verified duration before publishing. No Mux webhook or webhook secret is required by this code; readiness is polled through the admin endpoint.
6. Open as the member and watch at normal speed for at least 60 seconds. Confirm successful periodic heartbeats, increasing persisted bound intervals and an increasing confirmed percentage without reload. Do not infer database persistence solely from a moving timeline.
7. Pause/resume repeatedly, simulate buffering and a temporary connection interruption, replay covered content, reject an unwatched forward seek, then reload and reopen. Compare persisted session/interval state and the visible progress.
8. Complete the whole clip. Verify current bound completion is separate from historical completion; manually marking historical completion must not produce a verified record. Test reset and revocation on TEST accounts only.
9. Inspect errors via sanitized status/code/timing fields. Never share Cookie/Authorization headers, provider tokens, API keys, private signing keys or signed playback URLs. The server time budget constrains claims; it does not prove rendering or attention.
10. Repeat on desktop and a mobile viewport. Record actual results and commit hash. If any database or playback test fails, stop; do not raise thresholds or reset evidence to make the UI look successful.

Use the SQL suites for asset replacement and reset races; the admin UI does not provide an arbitrary asset-replacement control. Do not improvise production table edits to simulate that case.

## 13. Production approval gate — future work

Do not proceed until all TEST evidence is recorded and you explicitly approve production changes and any charges. Inventory production schema/migration ledger and custom grants, make a restorable backup, rehearse on a disposable clone, block member/admin traffic, and keep the app flag false. Apply only missing migrations in a controlled transaction-aware maintenance window. If 005/006 are needed, re-disable affected RPCs immediately after each because they restore legacy grants. Migration 008 is explicitly transactional but earlier files depend on the migration runner.

If a migration fails, leave traffic blocked and both gates off. Confirm actual committed schema/ACL state and repair forward; never assume an automatic downgrade or rerun initial table creation on an existing database. Historical intervals/completion dates must remain preserved. Source archives are not a rollback strategy.

A GitHub commit or successful Vercel build does not apply Migration 008. Pushing this release to a project still on schema 007 intentionally makes gated endpoints refuse operation. Do not respond by removing the gate. The correct next step is approved test verification, then a separately approved migration plan.

## 14. What I can automate in the next session

I can review diffs, run available local tests/builds, scan tracked files/archives without printing secrets, create or refine test scripts/docs, and update GitHub within your authorization. With local tools installed and your disposable target explicitly confirmed, I can run the local database and React suites. I can help interpret sanitized errors from dashboards.

You must use external dashboards to choose accounts/plans, enter secrets, verify Discord IDs/redirects, approve costs, and authorize hosted migrations/deployments. I will not ask you to paste secrets into chat or commit them. Production release remains blocked by unexecuted PostgreSQL, browser and authenticated provider verification.
