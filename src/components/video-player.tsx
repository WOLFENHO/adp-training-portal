'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MuxPlayer from '@mux/mux-player-react'
import { useRouter } from 'next/navigation'
import { readHeartbeatResponse } from '@/lib/heartbeat-response.mjs'
import { bindPauseBufferEvents, transitionRecoveryKind } from '@/lib/player-lifecycle.mjs'
import { playbackSessionMessage } from '@/lib/maintenance-messages.mjs'
import { createReceiptBarrier, createReceiptRetry, fetchWithDeadline, type ReceiptBarrier, type ReceiptRetry, type RetryOutcome } from '@/lib/playback-recovery.mjs'
import { visibleVerifiedPercent, intervalMarkers, shouldHideControls } from '@/lib/player-display.mjs'

type HeartbeatKind = 'play' | 'pause' | 'buffering' | 'periodic' | 'seek' | 'complete'
type Heartbeat = {
  requestId: string
  intentGeneration: number
  clientSequence: number
  position: number
  isPlaying: boolean
  kind: HeartbeatKind
  expectedVersion?: number
  scheduledAt: string
}
type Interval = { start_seconds: number; end_seconds: number }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function initialCoverage(rows: Interval[], duration: number) {
  const sorted = [...rows].sort((a, b) => a.start_seconds - b.start_seconds)
  let start: number | null = null
  let end = 0
  let total = 0
  for (const interval of sorted) {
    if (start === null) {
      start = interval.start_seconds
      end = interval.end_seconds
    } else if (interval.start_seconds <= end) {
      end = Math.max(end, interval.end_seconds)
    } else {
      total += end - start
      start = interval.start_seconds
      end = interval.end_seconds
    }
  }
  if (start !== null) total += end - start
  return duration ? Math.min(100, Math.floor((total / duration) * 100)) : 0
}

export function VideoPlayer({
  videoId,
  playbackId,
  token,
  duration,
  initialIntervals,
  complete,
  durationVerified,
  mediaComponent: MediaPlayer = MuxPlayer,
}: {
  videoId: string
  playbackId: string | null
  token?: string
  duration: number
  initialIntervals: Interval[]
  complete: boolean
  durationVerified: boolean
  /** Local integration harness may inject a media adapter; production uses Mux. */
  mediaComponent?: typeof MuxPlayer
}) {
  const router = useRouter()
  const ref = useRef<any>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const session = useRef<string | null>(null)
  const sessionTerminal = useRef(false)
  const sessionRequest = useRef<{ videoId: string; response: Promise<{ response: Response; data: any }> } | null>(null)
  const retryPending = useRef<((item: Heartbeat) => Promise<RetryOutcome>) | null>(null)
  const receiptRetry = useRef<ReceiptRetry<Heartbeat> | null>(null)
  const receiptBarrier = useRef<ReceiptBarrier<Heartbeat> | null>(null)
  const mounted = useRef(false)
  const sessionVersion = useRef(0)
  const resumeAt = useRef(0)
  const lastHeartbeat = useRef(0)
  const periodicPending = useRef(false)
  const pendingRequest = useRef<Heartbeat | null>(null)
  const intervals = useRef(initialIntervals)
  const lastPosition = useRef(0)
  const seekBack = useRef<number | null>(null)
  const correctingSeek = useRef(false)
  const endedAt = useRef<number | null>(null)
  const heartbeatQueue = useRef<Promise<void>>(Promise.resolve())
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsFocused = useRef(false)
  const playbackActive = useRef(false)
  const serverPlaying = useRef(false)
  const pauseRecoveryAttempted = useRef(false)
  const bufferingMedia = useRef(false)
  const resumingMedia = useRef(false)
  const initializedMedia = useRef<unknown>(null)
  const activationRequestId = useRef<string | null>(null)
  const suppressPauseEvent = useRef(false)
  const confirmedPosition = useRef(0)
  const requestSequence = useRef(0)
  const completionRefreshSent = useRef(complete)

  const [position, setPosition] = useState(0)
  const [confirmed, setConfirmed] = useState(() => initialCoverage(initialIntervals, duration))
  const [confirmedComplete, setConfirmedComplete] = useState(complete)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(true)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [message, setMessage] = useState('Preparing secure playback…')
  const [ready, setReady] = useState(false)
  const [sessionFailure, setSessionFailure] = useState(false)
  const [sessionAttempt, setSessionAttempt] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const tokens = useMemo(() => ({ playback: token }), [token])
  const metadata = useMemo(() => ({ video_id: videoId }), [videoId])

  useEffect(() => {
    mounted.current = true
    const barrier = createReceiptBarrier<Heartbeat>()
    receiptBarrier.current = barrier
    const controller = createReceiptRetry<Heartbeat>({
      attempt: (item) => retryPending.current?.(item) ?? Promise.resolve('network-error'),
    })
    receiptRetry.current = controller
    const online = () => { void controller.retryNow() }
    window.addEventListener('online', online)
    return () => {
      mounted.current = false
      window.removeEventListener('online', online)
      controller.dispose()
      barrier.dispose()
      if (receiptRetry.current === controller) receiptRetry.current = null
      if (receiptBarrier.current === barrier) receiptBarrier.current = null
    }
  }, [])

  const isCovered = (time: number) =>
    intervals.current.some((interval) => time >= interval.start_seconds && time <= interval.end_seconds)
  const isForwardPathCovered = (from: number, to: number) => {
    if (to <= from) return true
    let cursor = from
    for (const interval of [...intervals.current].sort((a, b) => a.start_seconds - b.start_seconds)) {
      if (interval.end_seconds < cursor) continue
      if (interval.start_seconds > cursor) return false
      cursor = Math.max(cursor, interval.end_seconds)
      if (cursor >= to) return true
    }
    return false
  }

  useEffect(() => {
    let alive = true
    if (sessionRequest.current?.videoId !== videoId) {
      sessionRequest.current = {
        videoId,
        response: fetchWithDeadline(async (url, options) => {
          const response = await fetch(url, options)
          return { response, data: await response.json() }
        }, `/api/videos/${videoId}/session`, { method: 'POST' }),
      }
    }
    sessionRequest.current.response
      .then(({ response, data }) => {
        if (!alive) return
        if (!response.ok || !data.sessionId) {
          sessionRequest.current = null
          setSessionFailure(true)
          setMessage(playbackSessionMessage(data.error, data.reason))
          setBuffering(false)
          return
        }
        session.current = data.sessionId
        sessionTerminal.current = false
        setSessionFailure(false)
        sessionVersion.current = data.version ?? 0
        requestSequence.current = data.lastEventSequence ?? 0
        resumeAt.current = data.position
        confirmedPosition.current = data.position
        serverPlaying.current = false
        lastHeartbeat.current = Date.now()
        setReady(true)
        setMessage((data.durationVerified ?? durationVerified) ? 'Progress saves automatically.' : 'Legacy duration is unverified. Playback remains available, but verified completion is disabled until Mux metadata is synchronized.')
      })
      .catch(() => {
        if (!alive) return
        sessionRequest.current = null
        setSessionFailure(true)
        setMessage('Playback session unavailable.')
        setBuffering(false)
      })
    return () => {
      alive = false
    }
  }, [videoId, sessionAttempt])

  const intentGeneration = useRef(0)
  const save = useCallback((pos: number, isPlaying: boolean, kind: HeartbeatKind) => {
    if (kind === 'play' || kind === 'pause' || kind === 'buffering') intentGeneration.current++
    const generation = intentGeneration.current
    const scheduledAt = new Date().toISOString()
    const request: Heartbeat = {
      intentGeneration: generation,
      requestId: crypto.randomUUID(),
      clientSequence: ++requestSequence.current,
      position: pos,
      isPlaying,
      kind,
      scheduledAt,
    }
    if (kind === 'periodic') periodicPending.current = true

    heartbeatQueue.current = heartbeatQueue.current.then(async () => {
      if (!mounted.current) return
      // An unknown receipt must be reconciled before a newer user intent.
      const barrier = receiptBarrier.current
      if (barrier && !(await barrier.wait())) return
      if (!session.current) {
        if (kind === 'periodic') periodicPending.current = false
        return
      }

      const send = async (item: Heartbeat): Promise<'accepted' | 'rejected' | 'network-error'> => {
        if (item.kind === 'play' && item.expectedVersion === undefined) {
          // Anchor the active window before resuming the media clock.
          item.position = confirmedPosition.current
        }
        if (item.kind === 'seek' && item.expectedVersion === undefined) {
          // A seek preserves the server's state after any queued stop or start.
          item.isPlaying = serverPlaying.current
        }
        item.expectedVersion ??= sessionVersion.current

        try {
          const { response, data } = await fetchWithDeadline(async (url, options) => {
            const response = await fetch(url, options)
            return { response, data: (await readHeartbeatResponse(response)).data }
          }, '/api/videos/heartbeat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId: session.current,
              requestId: item.requestId,
              expectedVersion: item.expectedVersion,
              clientSequence: item.clientSequence,
              position: item.position,
              isPlaying: item.isPlaying,
              kind: item.kind,
            }),
          })
          if (!mounted.current) return 'network-error'
          if (!response.ok || !data.accepted) {
            if (Number.isInteger(data.version)) sessionVersion.current = data.version
            if (Number.isSafeInteger(data.currentLastEventSequence ?? data.lastEventSequence)) {
              requestSequence.current = Math.max(requestSequence.current, data.currentLastEventSequence ?? data.lastEventSequence)
            }
            if (data.serverIsPlaying !== undefined) serverPlaying.current = data.serverIsPlaying
            if (serverPlaying.current === false) {
              pauseRecoveryAttempted.current = false
            }
            if (item.kind === 'play' && activationRequestId.current === item.requestId) {
              activationRequestId.current = null
              resumingMedia.current = false
              playbackActive.current = false
              setBuffering(false)
              setPlaying(false)
              if (ref.current && !ref.current.paused) {
                suppressPauseEvent.current = true
                ref.current.pause()
              }
            }
            if (data.code === 'stale_version') {
              confirmedPosition.current = data.acceptedPosition ?? confirmedPosition.current
              setMessage('A newer playback event was accepted. The next event will resynchronize; this event was not applied.')
            } else if (data.code === 'stale_event') {
              setMessage('An older playback event was rejected. Current server progress is unchanged.')
            } else if (data.code === 'sequence_out_of_range') {
              requestSequence.current = data.lastEventSequence ?? 0
              playbackActive.current = false
              ref.current?.pause()
              setMessage('Playback event ordering could not be resynchronized. Reopen the lesson to start a fresh session.')
            } else if (data.code === 'session_expired' || data.code === 'session_inactive' || data.code === 'asset_version_changed') {
              playbackActive.current = false
              sessionTerminal.current = true
              session.current = null
              if (ref.current && !ref.current.paused) {
                suppressPauseEvent.current = true
                ref.current.pause()
              }
              setMessage(data.error || 'Playback session ended. Reopen the lesson from the library.')
            } else if (response.status === 403) {
              sessionTerminal.current = true
              session.current = null
              if (ref.current && !ref.current.paused) {
                suppressPauseEvent.current = true
                ref.current.pause()
              }
              setMessage('Access was revoked or this playback session expired. Reopen the lesson from the library.')
            } else if (data.code === 'client_upgrade_required') {
              sessionTerminal.current = true
              session.current = null
              if (ref.current && !ref.current.paused) {
                suppressPauseEvent.current = true
                ref.current.pause()
              }
              setMessage('The portal was updated. Reload this lesson to continue safely.')
            } else {
              setMessage(`Progress was not accepted (${data.code || `HTTP ${response.status}`}). Playback was not added to confirmed progress.`)
            }
            return 'rejected'
          }

          sessionVersion.current = data.currentVersion ?? data.version
          confirmedPosition.current = data.currentAcceptedPosition ?? data.acceptedPosition
          serverPlaying.current = data.currentServerIsPlaying ?? data.serverIsPlaying
          if (!serverPlaying.current) {
            pauseRecoveryAttempted.current = false
          }
          if (data.currentSessionActive === false) {
            playbackActive.current = false
            sessionTerminal.current = true
            session.current = null
            resumingMedia.current = false
            activationRequestId.current = null
            if (ref.current && !ref.current.paused) {
              suppressPauseEvent.current = true
              ref.current.pause()
            }
            setPlaying(false)
            setMessage('This session was reset or replaced. Reopen the lesson from the library.')
            return 'rejected'
          }
          lastHeartbeat.current = Date.now()
          if (!data.duplicate || (data.currentVersion ?? data.version) === data.version) {
            intervals.current = data.intervals ?? intervals.current
            setConfirmed(data.percent ?? 0)
          }

          if (data.complete && (!data.duplicate || (data.currentVersion ?? data.version) === data.version)) {
            setConfirmedComplete(true)
            setMessage('Training complete.')
            if (!completionRefreshSent.current) {
              completionRefreshSent.current = true
              router.refresh()
            }
          }
          if (item.kind === 'play' && activationRequestId.current === item.requestId) {
            activationRequestId.current = null
            const media = ref.current
            if (serverPlaying.current && media) {
              resumingMedia.current = true
              const acceptedPosition = confirmedPosition.current
              lastPosition.current = acceptedPosition
              if (media.currentTime !== acceptedPosition) media.currentTime = acceptedPosition
              setPosition(acceptedPosition)
              void media.play().catch(() => {
                if (!resumingMedia.current) return
                resumingMedia.current = false
                setPlaying(false)
                setBuffering(false)
                save(acceptedPosition, false, 'pause')
                setMessage('Playback could not resume after server confirmation. Press play to retry.')
              })
            }
          }
          return 'accepted'
        } catch {
          if (!mounted.current) return 'network-error'
          if (item.isPlaying && ref.current && !ref.current.paused) {
            suppressPauseEvent.current = true
            ref.current.pause()
            playbackActive.current = false
            setPlaying(false)
            setBuffering(false)
            if (activationRequestId.current === item.requestId) activationRequestId.current = null
            // The stop follows the exact-request retry in the serialized queue.
            save(confirmedPosition.current, false, 'pause')
          }
          setMessage('Network interruption: progress is not confirmed. The same request will retry before newer progress.')
          return 'network-error'
        }
      }

      retryPending.current = async (item) => {
        if (pendingRequest.current !== item) return 'accepted'
        const outcome = await send(item)
        if (outcome !== 'network-error') {
          pendingRequest.current = null
          receiptBarrier.current?.settle(item)
          if (outcome === 'rejected') {
            const recoveryKind = transitionRecoveryKind(item.kind, false, serverPlaying.current, pauseRecoveryAttempted.current, item.intentGeneration, intentGeneration.current)
            if (recoveryKind && item.intentGeneration === intentGeneration.current) {
              pauseRecoveryAttempted.current = true
              save(confirmedPosition.current, false, recoveryKind)
            }
          }
        }
        return outcome
      }

      pendingRequest.current = request
      const result = await send(request)
      if (result !== 'network-error') pendingRequest.current = null
      if (result === 'network-error') {
        receiptBarrier.current?.hold(request)
        receiptRetry.current?.remember(request)
      }
      else receiptRetry.current?.resolve(request)
      if (result === 'rejected') {
        const recoveryKind = transitionRecoveryKind(request.kind, false, serverPlaying.current, pauseRecoveryAttempted.current, request.intentGeneration, intentGeneration.current)
        if (recoveryKind && generation === intentGeneration.current) {
          // Stop server active-time accounting at the last accepted position.
          // The rejected advancement is not replayed or promoted by this recovery.
          pauseRecoveryAttempted.current = true
          save(confirmedPosition.current, false, recoveryKind)
        } else if (request.kind === 'pause' || request.kind === 'buffering') {
          setMessage(serverPlaying.current
            ? 'Pause was not confirmed. Playback remains stopped; resume will resynchronize from confirmed progress.'
            : 'Playback is paused on the server. No rejected position was added to progress.')
        }
      }
      if (kind === 'periodic') periodicPending.current = false
    })
    return request.requestId
  }, [router])

  useEffect(() => {
    const el = ref.current
    if (!el || !ready) return
    const loaded = () => {
      if (initializedMedia.current === el) return
      initializedMedia.current = el
      lastPosition.current = resumeAt.current
      if (resumeAt.current > 0 && el.currentTime !== resumeAt.current) el.currentTime = resumeAt.current
      setPosition(resumeAt.current)
      setBuffering(false)
    }
    const maybePeriodic = (source: string) => {
      if (el.paused || el.seeking || !playbackActive.current || !serverPlaying.current || periodicPending.current) return
      if (Date.now() - lastHeartbeat.current >= 8000) {
        console.info('[ADP playback] periodic heartbeat scheduled', {
          source,
          mediaTime: el.currentTime,
          paused: el.paused,
          seeking: el.seeking,
          playbackActive: playbackActive.current,
          serverPlaying: serverPlaying.current,
          elapsedSinceAccepted: Date.now() - lastHeartbeat.current,
        })
        save(el.currentTime, true, 'periodic')
      }
    }
    const restorePosition = (target: number) => {
      correctingSeek.current = true
      seekBack.current = null
      lastPosition.current = target
      setPosition(target)
      el.currentTime = target
    }
    const time = () => {
      if (el.seeking || correctingSeek.current) return
      const current = el.currentTime
      const prior = lastPosition.current
      if (current > prior + 1.75 && !isCovered(prior)) {
        restorePosition(prior)
        setMessage('Forward seeking into unwatched sections is disabled.')
        return
      }
      lastPosition.current = current
      setPosition(current)
      maybePeriodic('timeupdate')
    }
    const seeking = () => {
      const target = el.currentTime
      const prior = lastPosition.current
      if (target > prior + 1.5 && !isForwardPathCovered(prior, target)) {
        restorePosition(seekBack.current ?? prior)
        setMessage('You can only seek within sections already watched.')
      } else {
        if (endedAt.current !== null && target < endedAt.current - 0.001) endedAt.current = null
        seekBack.current = null
        lastPosition.current = target
        setPosition(target)
      }
    }
    const seeked = () => {
      if (correctingSeek.current) {
        correctingSeek.current = false
        return
      }
      if (!resumingMedia.current && !activationRequestId.current && isCovered(el.currentTime)) save(el.currentTime, !el.paused, 'seek')
    }
    const play = () => {
      if (endedAt.current !== null) return
      setBuffering(true)
      setPlaying(true)
    }
    const playingNow = () => {
      if (el.paused || el.ended || endedAt.current !== null) return
      if (sessionTerminal.current) {
        suppressPauseEvent.current = true
        el.pause()
        setPlaying(false)
        return
      }
      bufferingMedia.current = false
      setPlaying(true)
      setBuffering(false)
      if (resumingMedia.current) {
        resumingMedia.current = false
        playbackActive.current = true
        setMessage('Progress saves automatically.')
        return
      }
      if (playbackActive.current || activationRequestId.current) return
      setBuffering(true)
      setMessage('Starting verified playback…')
      activationRequestId.current = save(confirmedPosition.current, true, 'play')
      suppressPauseEvent.current = true
      el.pause()
    }
    const pause = () => {
      if (suppressPauseEvent.current) {
        suppressPauseEvent.current = false
        return
      }
      if (el.ended || endedAt.current !== null) return
      setPlaying(false)
      setBuffering(false)
      resumingMedia.current = false
      activationRequestId.current = null
      playbackActive.current = false
      bufferingMedia.current = false
      pauseRecoveryAttempted.current = false
      save(el.currentTime, false, 'pause')
    }
    const wait = () => {
      if (el.paused || el.ended || endedAt.current !== null || el.seeking || correctingSeek.current || resumingMedia.current || bufferingMedia.current) return
      bufferingMedia.current = true
      const needsStop = playbackActive.current || activationRequestId.current !== null
      activationRequestId.current = null
      playbackActive.current = false
      setBuffering(true)
      if (!needsStop) return
      pauseRecoveryAttempted.current = false
      save(el.currentTime, false, 'buffering')
    }
    const can = () => {
      if (el.paused && !activationRequestId.current) setBuffering(false)
    }
    const ended = () => {
      if (endedAt.current !== null) return
      endedAt.current = el.currentTime
      resumingMedia.current = false
      activationRequestId.current = null
      playbackActive.current = false
      bufferingMedia.current = false
      setPlaying(false)
      setBuffering(false)
      save(el.currentTime, false, 'complete')
    }
    const periodicTimer = setInterval(() => maybePeriodic('timer'), 1000)
    el.addEventListener('loadedmetadata', loaded)
    el.addEventListener('timeupdate', time)
    el.addEventListener('seeking', seeking)
    el.addEventListener('seeked', seeked)
    el.addEventListener('play', play)
    el.addEventListener('playing', playingNow)
    const unbindPauseBuffer = bindPauseBufferEvents(el, {
      onPause: () => pause(),
      onBuffering: () => wait(),
    })
    el.addEventListener('canplay', can)
    el.addEventListener('ended', ended)
    if (el.readyState >= 1) loaded()
    return () => {
      clearInterval(periodicTimer)
      el.removeEventListener('loadedmetadata', loaded)
      el.removeEventListener('timeupdate', time)
      el.removeEventListener('seeking', seeking)
      el.removeEventListener('seeked', seeked)
      el.removeEventListener('play', play)
      el.removeEventListener('playing', playingNow)
      unbindPauseBuffer()
      el.removeEventListener('canplay', can)
      el.removeEventListener('ended', ended)
    }
  }, [ready, duration, save])

  const seek = (input: HTMLInputElement) => {
    const el = ref.current
    if (!el) return
    const value = input.valueAsNumber
    const current = lastPosition.current
    if (value > current + 1.5 && !isForwardPathCovered(current, value)) {
      input.value = String(current)
      setPosition(current)
      setMessage('That section has not been watched yet.')
      return
    }
    correctingSeek.current = false
    seekBack.current = current
    el.currentTime = value
    setPosition(value)
  }
  const reveal = () => {
    setControlsVisible(true)
    if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    if (playing) hiddenTimer.current = setTimeout(() => {
      if (shouldHideControls(true, controlsFocused.current)) setControlsVisible(false)
    }, 3000)
  }

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true)
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    } else reveal()
    return () => {
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
    }
  }, [playing])

  useEffect(() => {
    const onFullscreen = () => {
      setFullscreen(document.fullscreenElement === container.current)
      setControlsVisible(true)
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
      if (document.fullscreenElement === container.current && playing) {
        hiddenTimer.current = setTimeout(() => {
          if (shouldHideControls(true, controlsFocused.current)) setControlsVisible(false)
        }, 3000)
      }
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [playing])

  const segments = intervalMarkers(intervals.current, duration)
  const shownPercent = visibleVerifiedPercent(confirmed, confirmedComplete || complete)
  if (!playbackId || !token || !ready) {
    return <div className="video-frame"><div className="player-placeholder" role="status">{message}{sessionFailure && playbackId && token && <button className="button" onClick={() => { sessionRequest.current = null; setBuffering(true); setSessionFailure(false); setSessionAttempt((attempt) => attempt + 1) }}>Retry session</button>}</div></div>
  }

  return <>
    <div
      ref={container}
      className={`adp-player ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`}
      onMouseMove={reveal}
      onMouseEnter={reveal}
      onMouseLeave={() => {
        if (playing) {
          if (hiddenTimer.current) clearTimeout(hiddenTimer.current)
          hiddenTimer.current = setTimeout(() => {
            if (shouldHideControls(true, controlsFocused.current)) setControlsVisible(false)
          }, 3000)
        }
      }}
      onPointerDown={(event) => { if (event.pointerType === 'touch') setControlsVisible((visible) => !visible); else reveal() }}
      onKeyDown={reveal}
      onFocusCapture={() => { controlsFocused.current = true; reveal() }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          controlsFocused.current = false
          reveal()
        }
      }}
    >
      <MediaPlayer
        ref={ref}
        playbackId={playbackId}
        tokens={tokens}
        streamType="on-demand"
        metadata={metadata}
        playbackRates={[1]}
        disablePictureInPicture
        onVolumeChange={(event) => {
          const el = event.currentTarget as any
          setVolume(el.volume)
          setMuted(el.muted)
        }}
        onError={(event: any) => {
          const errorCode = event?.detail?.error?.code ?? event?.currentTarget?.error?.code ?? null
          console.error('[ADP playback] Mux player reported a media error', { code: errorCode })
          setMessage('Mux could not play this video. Check the playback ID and signed token configuration.')
          setBuffering(false)
        }}
        style={{ width: '100%', height: '100%' }}
      />
      <div className="player-state" aria-live="polite">{buffering ? <><span className="spinner"/> Buffering</> : playing ? 'Playing' : 'Paused'}</div>
      <div className="adp-controls" aria-hidden={!controlsVisible} inert={!controlsVisible}>
        <button className="player-button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => {
          const media = ref.current
          if (!media) return
          if (sessionTerminal.current) {
            setMessage('Playback session ended. Reopen the lesson from the library.')
            return
          }
          if (activationRequestId.current) {
            activationRequestId.current = null
            setPlaying(false)
            setBuffering(false)
            save(confirmedPosition.current, false, 'pause')
          } else if (!media.paused && endedAt.current === null) media.pause()
          else {
            endedAt.current = null
            void media.play().catch(() => {
              setPlaying(false)
              setBuffering(false)
              setMessage('Playback could not start. Press play to retry.')
            })
          }
        }}>{playing ? 'Ⅱ' : '▶'}</button>
        <span className="time-label">{fmt(position)}</span>
        <div className="timeline-wrap"><div className="timeline-track"><div className="watched-track">{segments.map((segment, index) => <i key={index} style={{ left: `${segment.left}%`, width: `${segment.width}%` }}/>)}</div><div className="playhead" style={{ left: `${duration ? position / duration * 100 : 0}%` }}/><input aria-label="Video timeline" aria-valuetext={`${fmt(position)} of ${fmt(duration)}`} type="range" min={0} max={duration || 1} step="0.1" value={position} onChange={(event) => seek(event.currentTarget)} onPointerDown={reveal} onFocus={reveal}/></div></div>
        <span className="time-label">{fmt(duration)}</span>
        <button className="player-button" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => { reveal(); if (ref.current) { ref.current.muted = !ref.current.muted; setMuted(ref.current.muted) } }}>{muted || volume === 0 ? '×' : '◖'}</button>
        <input className="volume-slider" aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { reveal(); const next = Number(event.target.value); if (ref.current) { ref.current.volume = next; ref.current.muted = next === 0 } setVolume(next); setMuted(next === 0) }} onPointerDown={reveal} onFocus={reveal}/>
        <button className="player-button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={async () => {
          reveal()
          const player = container.current
          if (!player) return
          try {
            if (document.fullscreenElement === player) await document.exitFullscreen()
            else await player.requestFullscreen()
          } catch {
            setMessage('Fullscreen is unavailable.')
          }
        }}>⛶</button>
      </div>
    </div>
    <div className="notice">{confirmedComplete || complete ? 'This lesson is recorded as complete.' : message} · {shownPercent}% server-confirmed</div>
    <div className="bar"><span style={{ width: `${shownPercent}%` }}/></div>
  </>
}
