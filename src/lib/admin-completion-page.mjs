/** Enrich one bounded completion page; a missing progress row is represented explicitly. */
export async function enrichCompletionPage(db, page, view) {
  if (!['historical', 'verified'].includes(view) || !Array.isArray(page) || page.length > 20) throw Error('invalid completion page')
  if (!page.length) return []
  const users = [...new Set(page.map(row => row.user_id))], videos = [...new Set(page.map(row => row.video_id))]
  const [membersResult, videosResult, progressResult] = await Promise.all([
    db.from('profiles').select('id,username').in('id', users).limit(21),
    db.from('videos').select('id,title,asset_id,duration_seconds,duration_precision_verified').in('id', videos).limit(21),
    db.from('user_video_progress').select('user_id,video_id').in('user_id', users).in('video_id', videos).limit(401),
  ])
  if ([membersResult, videosResult, progressResult].some(result => result.error || !Array.isArray(result.data)) ||
      membersResult.data.length > 20 || videosResult.data.length > 20 || progressResult.data.length > 400) throw Error('completion related data unavailable')
  const members = new Map(membersResult.data.map(row => [row.id, row.username]))
  const library = new Map(videosResult.data.map(row => [row.id, row]))
  const progress = new Set(progressResult.data.map(row => `${row.user_id}:${row.video_id}`))
  return page.map(row => {
    const lesson = library.get(row.video_id), username = members.get(row.user_id)
    if (!lesson || !username) throw Error('completion reference unavailable')
    const current = view === 'verified' && Boolean(lesson.duration_precision_verified && lesson.asset_id &&
      row.asset_id === lesson.asset_id && Number(row.duration_seconds) === Number(lesson.duration_seconds) &&
      row.validator_version === 12 && !row.reset_at && row.asset_identity === `${lesson.asset_id}:${Number(lesson.duration_seconds).toFixed(3)}:12`)
    return {
      userId: row.user_id, videoId: row.video_id, username, title: lesson.title,
      hasProgress: progress.has(`${row.user_id}:${row.video_id}`),
      status: view === 'historical' ? 'Historical completion' : current ? 'Current verified completion' : 'Previous verified evidence',
      completedAt: row.verified_at ?? row.completed_at,
      ...(view === 'historical' ? { method: row.method } : {}),
    }
  })
}
