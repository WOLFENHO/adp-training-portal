/** Stable public error identifiers. Never add raw provider/database messages here. */
const entries = Object.freeze({
  forbidden: ['ADP-AUTH-003', 403, 'Administrator or member access is required.'],
  sign_out_unavailable: ['ADP-AUTH-004', 503, 'Sign-out could not finish. Try again.'],
  oauth_callback_unavailable: ['ADP-AUTH-005', 503, 'Sign-in could not finish. Try again.'],
  invalid_request: ['ADP-API-001', 400, 'Check the request and try again.'],
  invalid_content_type: ['ADP-API-002', 415, 'Send a JSON request.'],
  invalid_cursor: ['ADP-API-003', 400, 'The page cursor is invalid. Start again from the first page.'],
  not_found: ['ADP-API-004', 404, 'The requested resource was not found.'],
  playback_maintenance: ['ADP-PRG-001', 503, 'Verified playback is temporarily disabled.'],
  session_expired: ['ADP-PRG-002', 409, 'The playback session expired. Reopen the lesson.'],
  session_inactive: ['ADP-PRG-003', 409, 'The playback session ended. Reopen the lesson.'],
  session_unavailable: ['ADP-PRG-004', 503, 'Playback session could not be started. Try again.'],
  playback_schema_unavailable: ['ADP-PRG-005', 503, 'Verified playback is temporarily unavailable.'],
  heartbeat_unavailable: ['ADP-PRG-006', 503, 'Progress could not be confirmed. Retry the request.'],
  playback_signing_unavailable: ['ADP-PRG-007', 503, 'A playback token could not be issued. Try again.'],
  video_unavailable: ['ADP-PRG-008', 503, 'The video is temporarily unavailable.'],
  admin_data_unavailable: ['ADP-ADM-002', 503, 'Administration data could not be loaded. Try again.'],
  video_delete_disabled: ['ADP-ADM-003', 409, 'Unpublish the video to retain training history.'],
  video_not_found: ['ADP-ADM-004', 404, 'The video record was not found.'],
  video_metadata_unverified: ['ADP-ADM-005', 409, 'Publishing requires verified video metadata.'],
  video_record_update_failed: ['ADP-ADM-006', 503, 'Video details could not be saved. Try again.'],
  mux_upload_creation_failed: ['ADP-ADM-007', 502, 'Mux could not create an upload target. Try again.'],
  video_record_create_failed: ['ADP-ADM-008', 503, 'Video setup could not finish. Ask an administrator to review the pending upload.'],
  whitelist_write_failed: ['ADP-ADM-009', 503, 'The whitelist change could not be saved. Try again.'],
  metadata_sync_disabled: ['ADP-ADM-010', 503, 'Mux metadata synchronization is disabled.'],
  metadata_sync_unavailable: ['ADP-ADM-011', 503, 'Mux metadata synchronization is unavailable.'],
  metadata_already_verified: ['ADP-ADM-012', 409, 'Mux metadata is already verified.'],
  mux_credentials_missing: ['ADP-ADM-013', 503, 'Mux integration is temporarily unavailable.'],
  mux_upload_missing: ['ADP-ADM-014', 404, 'No Mux upload is linked to this video.'],
  mux_sync_failed: ['ADP-ADM-015', 502, 'Mux metadata could not be synchronized.'],
  bootstrap_admin_locked: ['ADP-ADM-016', 400, 'The bootstrap administrator cannot be removed.'],
  video_publish_check_failed: ['ADP-ADM-017', 503, 'Video publishing readiness could not be checked.'],
  upload_intent_conflict: ['ADP-ADM-018', 409, 'This upload attempt changed. Review the pending upload before starting another.'],
  upload_requires_reconciliation: ['ADP-ADM-019', 503, 'The upload state is uncertain. Ask an administrator to review it before retrying.'],
  admin_progress_unavailable: ['ADP-ADM-020', 503, 'The progress action could not be confirmed. Reload before trying again.'],
  uploads_disabled: ['ADP-ADM-021', 503, 'New video uploads are temporarily disabled.'],
  admin_unavailable: ['ADP-ADM-099', 503, 'The administrator operation could not be completed.'],
})

export function identifyError(code) {
  const [errorId, status, message] = entries[code] ?? entries.admin_unavailable
  return { errorId, status, message }
}

export function sanitizeApiError(code, correlationId, _untrusted = null) {
  const known = Object.hasOwn(entries, code) ? code : 'admin_unavailable'
  const { errorId, message } = identifyError(known)
  return { error: known, errorId, correlationId, reason: message }
}

