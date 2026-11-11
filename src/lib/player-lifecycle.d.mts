export type StopKind = 'pause' | 'buffering'
export function bindPauseBufferEvents(
  media: { currentTime: number; addEventListener: (type: string, listener: EventListener) => void; removeEventListener: (type: string, listener: EventListener) => void },
  handlers: { onPause: (kind: 'pause', position: number) => void; onBuffering: (kind: 'buffering', position: number) => void },
): () => void
export function transitionRecoveryKind(
  kind: string,
  accepted: boolean,
  serverPlaying: boolean,
  alreadyAttempted: boolean,
  eventGeneration?: number,
  currentGeneration?: number,
): StopKind | null
