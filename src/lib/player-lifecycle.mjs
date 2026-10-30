/** Bind browser media events to the heartbeat state names understood by SQL. */
export function bindPauseBufferEvents(media, { onPause, onBuffering }) {
  const pause = () => onPause('pause', media.currentTime)
  const waiting = () => onBuffering('buffering', media.currentTime)
  media.addEventListener('pause', pause)
  media.addEventListener('waiting', waiting)
  return () => {
    media.removeEventListener('pause', pause)
    media.removeEventListener('waiting', waiting)
  }
}

/** A rejected stop transition is retried from server-confirmed time once. */
export function transitionRecoveryKind(kind, accepted, serverPlaying, alreadyAttempted) {
  if (accepted || !serverPlaying || alreadyAttempted) return null
  if (kind === 'pause' || kind === 'buffering') return kind
  return null
}

/** Resume only after the server has accepted the active-playback transition. */
export function requiresServerPlayActivation(serverPlaying, stopTransitionPending) {
  return !serverPlaying || stopTransitionPending
}
