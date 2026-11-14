# QC-022 / QC-024 receipt and token policies (proposal)

## Enforceable boundaries in the current code

The database heartbeat RPC locks a session and checks its 12-hour expiry before applying a new event. It returns stored receipts for duplicate requests while the session is valid. `cleanup_expired_playback_receipts()` retires sessions older than 12 hours and removes their receipts only after they are inactive; only `service_role` has EXECUTE in the repository definition. Application/database playback gates prevent new playback tokens and progress when disabled. Neither switch invalidates an already signed Mux bearer token.

## Receipt retention

Propose a daily service-role job with a 24-hour safety margin after `started_at + 12 hours`. The existing cleanup function deletes at 12 hours, so **do not schedule it as-is** until its cutoff and all call sites are reviewed against the current deployed definition. Capture function fingerprint and counts by age first. A separate bounded candidate should delete at most one configured batch per invocation, use a grace period after session expiry, preserve receipts for active sessions and expose aggregate removal/failure counts without session IDs. An approved scheduler needs monitoring and a disable switch. Never purge verified intervals, progress, or completion evidence with receipt cleanup. Test retry at 11:59:59, expiry at 12:00, concurrent cleanup/heartbeat and repeated jobs in isolated PostgreSQL.

## Token revocation and maintenance

The current token expiry is `max(15, ceil(video_duration_minutes)+2)` minutes and the player has no signed-token renewal path. Record the maximum issued expiry across the library before choosing a shutdown window. For routine maintenance, disable the database playback switch first, then the application flag; verify no new tokens, heartbeats or completion. Existing signed URLs may stream until their token expiry. Whitelist removal prevents new portal authorization but cannot revoke a previously issued Mux token. For immediate media denial, an authorized Mux key or playback-policy action may affect the Sites fallback and other viewers and requires a separate incident procedure. Do not shorten tokens below long-video duration until a tested renewal path exists. Validate mid-play revocation, old-token behavior, long pause, clock skew, reauthorization and emergency disable in isolation before adopting a new policy.

These are proposed operational controls. No scheduler, key change, playback switch or production record was modified.
