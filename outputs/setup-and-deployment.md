# ADP Internal Training Portal

A small private video library for the Analytics Development Program. It uses Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/Postgres, Discord OAuth, and Mux signed playback. Vercel is the deployment target.

This is a purpose-built video portal, not a general LMS. It provides a private library, sequential watch progress, whitelist and administrator tools, and an audit trail.

## Run locally

1. Install Node.js 20.9+ and run `npm install`.
2. Create the Supabase and Mux projects described below.
3. Copy `.env.example` to `.env.local` and enter the server and public keys.
4. Run the SQL migration in `supabase/migrations/202610290001_init.sql` using the Supabase SQL Editor.
5. Set the Discord and Supabase callback URLs as described below.
6. Run `npm run dev` and open `http://localhost:3000`.

`npm run typecheck` checks TypeScript. `npm run build` creates the production build.

## Environment variables

| Name | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical origin, e.g. `http://localhost:3000` or the Vercel production URL. |
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

The SQL migration creates profiles, Discord whitelist IDs, administrator roles, videos, user progress, watched intervals, completion records, playback sessions, and administrator audit logs. RLS is enabled for all tables. Authenticated members can read only their own progress and intervals; administrators can read all rows. Mutations to watch progress are performed only by security-definer Postgres functions.

For each playback session, the server chooses the first not-yet-covered time range and invalidates the previous active tab for that member/video. Heartbeats are bound to the authenticated Supabase user and validated against server elapsed time while the player is active; paused time does not permit forward advancement. Excessive advancement is rejected. Only watched intervals are counted, and completion requires contiguous coverage from the start through the end, allowing small timing tolerance for segment boundaries. Progress is saved during playback and on pause. A removed whitelist entry blocks subsequent protected pages, playback-token issuance, and progress heartbeats.

The client disables playback-rate choices and blocks forward seeking. As with any browser player, these checks cannot prove attention or prevent screen capture or all developer-tool manipulation. Server validation makes casual skipping and forged completion requests harder; it is not proctoring. Signed Mux playback tokens are bearer URLs and remain valid until their expiry (video duration plus a small buffer); no browser-only design can instantly revoke a token already issued to Mux.

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
