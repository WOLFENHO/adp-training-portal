export function playbackSessionMessage(code, fallback) {
  if (code === 'playback_maintenance') {
    return 'Verified playback is temporarily disabled while database readiness is pending.'
  }
  if (code === 'playback_schema_unavailable') {
    return 'Verified playback is unavailable because the Release 1.2 database readiness check did not pass.'
  }
  return fallback || 'Playback session could not be started.'
}

export function adminDashboardMessage(code) {
  if (code === 'admin_data_unavailable') return 'The dashboard data could not be read. Check the Site runtime database credentials and logs.'
  if (code === 'forbidden') return 'Administrator access is required to load this dashboard.'
  return 'Administration data could not be loaded. Retry after checking the Site runtime logs.'
}

export function adminActionMessage(code) {
  if (code === 'metadata_sync_disabled') return 'Mux metadata synchronization is disabled. It will remain off until separately approved.'
  if (code === 'schema_maintenance') return 'Mux metadata synchronization is unavailable because the Release 1.2 readiness check did not pass.'
  if (code === 'metadata_sync_unavailable') return 'Mux metadata synchronization is unavailable because its maintenance-only database readiness check did not pass. Playback remains disabled.'
  if (code === 'mux_credentials_missing') return 'Mux metadata synchronization is unavailable because the required Mux runtime credentials are missing.'
  if (code === 'mux_upload_missing') return 'This video has no Mux upload to synchronize.'
  if (code === 'metadata_already_verified') return 'This video’s Mux metadata is already verified.'
  if (code === 'admin_data_unavailable') return 'The video metadata could not be read. Check the Site runtime database credentials and logs.'
  return null
}

export function adminMutationMessage(action, response, status) {
  const code = response?.error
  const dbCode = response?.databaseCode ? ` (database code ${response.databaseCode})` : ''
  if (action === 'access' && code === 'invalid_request') return 'Enter a Discord user ID using digits only (5–25 digits).'
  if (action === 'access' && code === 'bootstrap_admin_locked') return 'The bootstrap administrator cannot be removed from the whitelist.'
  if (action === 'access' && code === 'whitelist_write_failed') return `Supabase could not ${response?.operation === 'remove' ? 'remove' : 'add'} this Discord ID${dbCode}. Check the Site runtime database permissions.`
  if (code === 'mux_credentials_missing') return 'Mux upload credentials are missing from the Site runtime settings.'
  if (code === 'mux_upload_creation_failed') return 'Mux could not create an upload target. No video record was created.'
  if (code === 'video_record_create_failed') return `Mux created an upload target, but Supabase could not save its video record${dbCode}. Do not retry until the orphaned upload is reviewed.`
  if (code === 'video_record_update_failed') return `Supabase could not save the video record${dbCode}.`
  if (code === 'video_metadata_unverified') return 'Publishing is blocked because this video’s Mux playback ID and duration are not verified in Supabase. The video was left unpublished; run metadata sync only after it is separately approved.'
  if (code === 'video_publish_check_failed') return `Supabase could not verify this video’s publish readiness${dbCode}. The video was left unchanged.`
  if (code === 'video_not_found') return 'This video record no longer exists, so it was not published.'
  if (code === 'video_record_unavailable') return 'The video record could not be read, so deletion was stopped.'
  if (code === 'mux_asset_delete_failed') return 'Mux could not delete the asset. The database video record was left unchanged.'
  if (code === 'video_record_delete_failed_after_mux_asset_delete') return `Mux deleted the asset, but Supabase could not delete its video record${dbCode}. Contact an administrator before retrying.`
  if (code === 'video_record_delete_failed') return `Supabase could not delete the video record${dbCode}.`
  return `${code || 'The request failed'} (HTTP ${status}). Check the Site logs and try again.`
}
