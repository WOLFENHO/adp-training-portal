import { summarizeVideoProgress } from './progress-status.mjs'

const SELECTS = {
  profiles: 'id,username',
  videos: 'id,title,asset_id,duration_seconds,duration_precision_verified',
  completion_records: 'user_id,video_id,completed_at,method',
  verified_completion_records: 'user_id,video_id,asset_id,duration_seconds,completed_at,verified_at,validator_version,asset_identity,reset_at',
}

/** Bounded join for one progress page. Missing or truncated related data fails visibly. */
export async function enrichProgressPage(db, page) {
  if (!Array.isArray(page) || page.length > 20) throw new Error('invalid progress page')
  if (!page.length) return []
  const users = [...new Set(page.map(row => row.user_id))]
  const videos = [...new Set(page.map(row => row.video_id))]
  const names = Object.keys(SELECTS)
  const results = await Promise.all(names.map(name => {
    let query = db.from(name).select(SELECTS[name])
    if (name === 'profiles') query = query.in('id', users)
    else if (name === 'videos') query = query.in('id', videos)
    else query = query.in('user_id', users).in('video_id', videos)
    return query.limit(1001)
  }))
  if (results.some(result => result.error || !Array.isArray(result.data) || result.data.length > 1000)) throw new Error('progress related data unavailable')
  const [profiles, videoRows, historical, verified] = results.map(result => result.data)
  const members = new Map(profiles.map(row => [row.id, row]))
  const library = new Map(videoRows.map(row => [row.id, row]))
  return page.map(row => {
    const member = members.get(row.user_id), video = library.get(row.video_id)
    if (!member || !video) throw new Error('progress reference unavailable')
    const matches = item => item.user_id === row.user_id && item.video_id === row.video_id
    const current = verified.filter(matches)
    const summary = summarizeVideoProgress(video, row, current, historical.filter(matches))
    const identity = video.asset_id && `${video.asset_id}:${Number(video.duration_seconds).toFixed(3)}:12`
    const verifiedRow = current.find(item => video.duration_precision_verified && !item.reset_at && item.validator_version === 12 && item.asset_id === video.asset_id && item.asset_identity === identity && Number(item.duration_seconds) === Number(video.duration_seconds))
    return { userId: row.user_id, videoId: row.video_id, username: member.username, title: video.title, durationSeconds: video.duration_seconds, status: summary.status, label: summary.label, percent: summary.percent, verifiedWatchedSeconds: summary.verifiedWatchedSeconds, historicalCompletedAt: summary.historicalCompletedAt, verifiedCompletedAt: verifiedRow?.verified_at ?? verifiedRow?.completed_at ?? null, hasHistoricalRecord: historical.some(matches) }
  })
}
