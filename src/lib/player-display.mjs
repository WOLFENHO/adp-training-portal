/** Coverage percentage is presentation only; completion is server-authored. */
export function visibleVerifiedPercent(percent, complete) {
  if (complete) return 100
  if (!Number.isFinite(percent)) return 0
  return Math.min(99.9, Math.max(0, Math.floor(percent * 10) / 10))
}

/** Render O(intervals) ranges, independent of lesson duration. */
export function intervalMarkers(intervals, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return []
  return intervals.flatMap(({ start_seconds, end_seconds }) => {
    const start = Math.min(duration, Math.max(0, Number(start_seconds)))
    const end = Math.min(duration, Math.max(0, Number(end_seconds)))
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ left: start / duration * 100, width: (end - start) / duration * 100 }]
      : []
  })
}

export function shouldHideControls(playing, focusWithin) {
  return Boolean(playing && !focusWithin)
}
