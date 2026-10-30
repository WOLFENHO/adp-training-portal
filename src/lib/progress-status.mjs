export function summarizeVideoProgress(video, progress, verifiedRows = [], historicalRows = []) {
  const currentVerified = Boolean(video.duration_precision_verified && video.asset_id && verifiedRows.some((row) =>
    row.validator_version === 12 && row.asset_id === video.asset_id &&
    Number(row.duration_seconds) === Number(video.duration_seconds),
  ))
  const historicalDates = [
    progress?.completed_at,
    ...historicalRows.map((row) => row.completed_at),
    ...verifiedRows
      .filter((row) => row.validator_version === 12 &&
        !(video.duration_precision_verified && row.asset_id === video.asset_id && Number(row.duration_seconds) === Number(video.duration_seconds)))
      .map((row) => row.completed_at),
  ].filter(Boolean)
  const watched = Math.max(0, Number(progress?.verified_watched_seconds ?? 0))
  const percent = currentVerified
    ? 100
    : Math.min(100, Math.floor((watched / Math.max(Number(video.duration_seconds), 1)) * 100))
  const status = currentVerified
    ? 'verified_completed'
    : watched > 0
      ? 'in_progress'
      : historicalDates.length
        ? 'historical_completed'
        : 'unstarted'
  return {
    currentVerified,
    percent,
    status,
    label: status === 'verified_completed' ? 'Verified complete'
      : status === 'historical_completed' ? 'Historical completion'
        : status === 'in_progress' ? 'In progress' : 'Unstarted',
    historicalCompletedAt: historicalDates.sort()[historicalDates.length - 1] ?? null,
    verifiedWatchedSeconds: watched,
  }
}
