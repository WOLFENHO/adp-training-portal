/** This presentation model mirrors the database's current-asset proof rule.
 * The database RPC remains the authority for playback/session access. */
export function currentVerifiedCompletion(video, rows) {
  if (!video.asset_id || !video.duration_precision_verified || !(Number(video.duration_seconds) > 0)) return false
  const identity = `${video.asset_id}:${Number(video.duration_seconds).toFixed(3)}:12`
  return rows.some(row => row.video_id === video.id && row.validator_version === 12 &&
    row.asset_id === video.asset_id && Number(row.duration_seconds) === Number(video.duration_seconds) &&
    row.asset_identity === identity && !row.reset_at && Boolean(row.verified_at))
}

export function trainingSequence(videos, verifiedRows) {
  const ordered = [...videos].filter(video => video.published)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  const unlocked = {}
  let priorComplete = true
  for (const video of ordered) {
    unlocked[video.id] = priorComplete
    priorComplete = priorComplete && currentVerifiedCompletion(video, verifiedRows)
  }
  return unlocked
}
